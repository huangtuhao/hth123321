'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vmModule = require('node:vm');

const sourcePath = path.resolve(__dirname, '..', 'src', 'request-probe.user.js');

function loadProbe({ vueInstance = null, fetchImpl = null } = {}) {
  let source = fs.readFileSync(sourcePath, 'utf8');
  source = source.replace(/\}\(\)\);\s*$/, `
    globalThis.__probeTestApi = Object.freeze({
      startRecording,
      stopRecording,
      sanitizeValue,
      compactRuntimeText,
      normalizeRuntimeSummary,
      state,
    });
  }());`);

  class FakeXhr {
    constructor() {
      this.responseType = '';
      this.status = 200;
      this.responseText = '{}';
      this.response = null;
      this.listeners = [];
      this.sendCalls = 0;
    }

    open() {
      this.openCalls = (this.openCalls || 0) + 1;
    }

    setRequestHeader() {}

    send() {
      this.sendCalls += 1;
      return 'xhr-result';
    }

    addEventListener(name, handler) {
      this.listeners.push({ name, handler });
    }

    getResponseHeader() {
      return 'application/json';
    }
  }

  const rootElement = vueInstance ? { __vue__: vueInstance } : null;
  const document = {
    readyState: 'loading',
    title: 'Probe test',
    documentElement: {},
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll(selector) {
      return selector === '#app' && rootElement ? [rootElement] : [];
    },
  };
  const originalFetch = fetchImpl || (() => Promise.resolve({
    status: 200,
    headers: new Headers({ 'content-type': 'application/json', 'content-length': '2' }),
    clone() { return this; },
    text: async () => '{}',
    body: null,
  }));
  const pageWindow = {
    document,
    location: new URL('https://erp.lingxing.com/erp/test'),
    XMLHttpRequest: FakeXhr,
    fetch: originalFetch,
    Headers,
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval() { return 2; },
    clearInterval() {},
  };
  const context = vmModule.createContext({
    unsafeWindow: pageWindow,
    window: pageWindow,
    document,
    URL,
    URLSearchParams,
    Headers,
    Blob,
    TextEncoder,
    TextDecoder,
    WeakMap,
    WeakSet,
    Set,
    Map,
    Object,
    Array,
    Promise,
    Reflect,
    Date,
    Number,
    String,
    Boolean,
    RegExp,
    JSON,
    console: { log() {}, warn() {}, error() {} },
    confirm: () => true,
    prompt: () => null,
    alert() {},
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest() {},
    GM_getValue: () => '',
    GM_setValue() {},
  });
  vmModule.runInContext(source, context, { filename: sourcePath });
  return { api: context.__probeTestApi, pageWindow, FakeXhr, originalFetch };
}

test('network hooks stay untouched until probe recording starts', () => {
  const { api, pageWindow, originalFetch } = loadProbe();
  assert.equal(pageWindow.fetch, originalFetch);
  assert.equal(api.state.networkHooksInstalled, false);
  api.startRecording();
  assert.notEqual(pageWindow.fetch, originalFetch);
  assert.equal(api.state.networkHooksInstalled, true);
});

test('collapsed runtime label prioritizes offline, error and running states', () => {
  const { api } = loadProbe();
  api.state.runtime.bridge = 'offline';
  assert.equal(api.compactRuntimeText(), '● 本地桥离线');
  api.state.runtime.bridge = 'online';
  api.state.runtime.summary = api.normalizeRuntimeSummary({ online_clients: 3, running: 1, error: 0 });
  assert.equal(api.compactRuntimeText(), '● 3 在线 · 1 运行');
  api.state.runtime.summary = api.normalizeRuntimeSummary({ online_clients: 3, running: 1, error: 2 });
  assert.equal(api.compactRuntimeText(), '● 3 在线 · 2 异常');
});

test('request hooks fail open when sanitizing a revoked Proxy', async () => {
  let fetchCalls = 0;
  const originalPromise = Promise.resolve({ status: 200, headers: new Headers(), clone() { return this; }, body: null });
  const fetchImpl = () => {
    fetchCalls += 1;
    return originalPromise;
  };
  let logicalCalls = 0;
  const vueInstance = {
    $gwPost() {
      logicalCalls += 1;
      return 'logical-result';
    },
  };
  const { api, pageWindow, FakeXhr } = loadProbe({ vueInstance, fetchImpl });
  api.startRecording();

  const revokedOne = Proxy.revocable({}, {});
  revokedOne.revoke();
  const xhr = new FakeXhr();
  xhr.open('POST', 'https://gw.lingxingerp.com/api/test');
  assert.equal(xhr.send(revokedOne.proxy), 'xhr-result');
  assert.equal(xhr.sendCalls, 1);

  const revokedTwo = Proxy.revocable({}, {});
  revokedTwo.revoke();
  const fetchResult = pageWindow.fetch('https://gw.lingxingerp.com/api/test', {
    method: 'POST',
    body: revokedTwo.proxy,
  });
  assert.equal(fetchResult, originalPromise);
  assert.equal(fetchCalls, 1);

  const revokedThree = Proxy.revocable({}, {});
  revokedThree.revoke();
  assert.equal(vueInstance.$gwPost('/api/test', revokedThree.proxy), 'logical-result');
  assert.equal(logicalCalls, 1);
  await originalPromise;
});

test('camelCase credentials and contact fields are redacted', () => {
  const { api } = loadProbe();
  const sanitized = api.sanitizeValue({
    receiverName: '张三',
    shippingAddress: '某市某路 1 号',
    buyerName: '李四',
    apiKey: 'short-key',
    token: 'short-token',
    sid: '12345',
    safeField: '保留值',
  });
  assert.equal(sanitized.receiverName, '[REDACTED]');
  assert.equal(sanitized.shippingAddress, '[REDACTED]');
  assert.equal(sanitized.buyerName, '[REDACTED]');
  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.equal(sanitized.token, '[REDACTED]');
  assert.equal(sanitized.sid, '[REDACTED]');
  assert.equal(sanitized.safeField, '保留值');
});

test('stopping does not overwrite a page method replaced during recording', () => {
  const original = () => 'original';
  const replacement = () => 'replacement';
  const vueInstance = { $gwPost: original };
  const { api } = loadProbe({ vueInstance });
  api.startRecording();
  assert.notEqual(vueInstance.$gwPost, original);
  vueInstance.$gwPost = replacement;
  api.stopRecording();
  assert.equal(vueInstance.$gwPost, replacement);
});
