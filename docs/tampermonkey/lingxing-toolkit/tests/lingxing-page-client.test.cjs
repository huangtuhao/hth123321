'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sdk = require('../lib/lingxing-page-client.js');

function fakePage(root) {
  const element = { __vue__: root };
  const document = {
    querySelectorAll(selector) {
      return selector === '#app' ? [element] : [];
    },
  };
  return {
    document,
    location: { origin: 'https://erp.lingxing.com', pathname: '/erp/test' },
  };
}

function makeAllTransports(calls) {
  const gate = {
    marker: 'gate-owner',
    get(path, config) {
      assert.equal(this, gate);
      calls.push({ transport: 'gateGet', path, config });
      return Promise.resolve({ data: { from: 'gateGet' } });
    },
    post(path, payload, config) {
      assert.equal(this, gate);
      calls.push({ transport: 'gatePost', path, payload, config });
      return Promise.resolve({ data: { from: 'gatePost' } });
    },
  };
  const vm = {
    marker: 'vue-owner',
    $post(path, payload, requestConfig, arg4, arg5, sequenceGroup) {
      assert.equal(this, vm);
      calls.push({
        transport: 'post',
        path,
        payload,
        requestConfig,
        arg4,
        arg5,
        sequenceGroup,
      });
      return Promise.resolve({ data: { code: 1, data: { from: 'post' } } });
    },
    $gwPost(path, payload) {
      assert.equal(this, vm);
      calls.push({ transport: 'gwPost', path, payload });
      return Promise.resolve({ code: 1, data: { from: 'gwPost' } });
    },
    $gateAxios: gate,
    $children: [],
  };
  return vm;
}

test('UMD build installs LingXingPageClient on a browser-like global', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../lib/lingxing-page-client.js'),
    'utf8',
  );
  const context = { setTimeout, clearTimeout };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'lingxing-page-client.js' });

  assert.equal(typeof context.LingXingPageClient.connect, 'function');
  assert.equal(typeof context.LingXingPageClient.find, 'function');
  assert.deepEqual(
    Array.from(context.LingXingPageClient.TRANSPORTS),
    ['post', 'gwPost', 'gateGet', 'gatePost'],
  );
});

test('CommonJS API exposes explicit transports and reports no fetch fallback', async () => {
  const calls = [];
  const client = await sdk.connect({
    pageWindow: fakePage(makeAllTransports(calls)),
    requiredTransports: ['post', 'gwPost', 'gateGet', 'gatePost'],
    timeoutMs: 0,
  });

  assert.deepEqual(client.capabilities(), {
    transports: ['post', 'gwPost', 'gateGet', 'gatePost'],
    rawFetchFallback: false,
  });
  assert.equal(client.diagnostics().security.rawFetchFallback, false);
  assert.equal(client.diagnostics().security.readsCredentials, false);
});

test('post dispatches through $post, preserves this, and places sequenceGroup in argument six', async () => {
  const calls = [];
  const client = await sdk.connect({
    pageWindow: fakePage(makeAllTransports(calls)),
    requiredTransports: ['post'],
    timeoutMs: 0,
  });

  const result = await client.post('/api/fba_shipment/showShipment_v2', { offset: 0 }, {
    sequenceGroup: 'fbaCargo',
    requestConfig: { timeout: 1000 },
  });

  assert.deepEqual(result, { code: 1, data: { from: 'post' } });
  assert.deepEqual(calls, [{
    transport: 'post',
    path: '/api/fba_shipment/showShipment_v2',
    payload: { offset: 0 },
    requestConfig: { timeout: 1000 },
    arg4: null,
    arg5: null,
    sequenceGroup: 'fbaCargo',
  }]);
});

test('gwPost, gateGet, and gatePost dispatch only to their matching page clients', async () => {
  const calls = [];
  const client = await sdk.connect({
    pageWindow: fakePage(makeAllTransports(calls)),
    requiredTransports: ['gwPost', 'gateGet', 'gatePost'],
    timeoutMs: 0,
  });

  const gw = await client.gwPost('/amz-sta-server/example', { sid: 9 });
  const get = await client.gateGet('/api/product/info', { params: { id: 7 } });
  const post = await client.gatePost('/api/file/example', { id: 11 }, { responseType: 'blob' });

  assert.deepEqual(gw, { code: 1, data: { from: 'gwPost' } });
  assert.deepEqual(get, { data: { from: 'gateGet' } });
  assert.deepEqual(post, { data: { from: 'gatePost' } });
  assert.deepEqual(calls.map((entry) => entry.transport), ['gwPost', 'gateGet', 'gatePost']);
});

test('discovery traverses Vue parent and child links and can combine transports from different instances', async () => {
  const calls = [];
  const transportVm = makeAllTransports(calls);
  const shellVm = { $children: [{ $children: [], $parent: transportVm }] };
  transportVm.$children = [shellVm];

  const client = await sdk.connect({
    pageWindow: fakePage(shellVm),
    requiredTransports: ['post', 'gatePost'],
    timeoutMs: 0,
  });

  assert.deepEqual(client.capabilities().transports, ['post', 'gwPost', 'gateGet', 'gatePost']);
  assert.ok(client.diagnostics().scan.visitedCount >= 2);
});

test('missing required transport rejects with a structured timeout error', async () => {
  const vm = { $children: [] };
  await assert.rejects(
    sdk.connect({
      pageWindow: fakePage(vm),
      requiredTransports: ['post'],
      timeoutMs: 0,
    }),
    (caught) => {
      assert.equal(caught.name, 'LingXingPageClientError');
      assert.equal(caught.code, 'LINGXING_CLIENT_TIMEOUT');
      assert.deepEqual(caught.details.missingTransports, ['post']);
      assert.equal(caught.details.diagnostics.security.rawFetchFallback, false);
      return true;
    },
  );
});

test('calling an unavailable optional transport raises a structured error without raw fallback', async () => {
  const vm = {
    $post() {
      return Promise.resolve({ code: 1 });
    },
    $children: [],
  };
  const client = await sdk.connect({
    pageWindow: fakePage(vm),
    requiredTransports: ['post'],
    timeoutMs: 0,
  });

  await assert.rejects(
    client.gwPost('/missing', {}),
    (caught) => {
      assert.equal(caught.code, 'LINGXING_TRANSPORT_UNAVAILABLE');
      assert.equal(caught.details.transport, 'gwPost');
      assert.equal(caught.details.diagnostics.security.rawFetchFallback, false);
      return true;
    },
  );
});

test('request paths are restricted to LingXing site-relative paths', async () => {
  const calls = [];
  const vm = {
    $gwPost(path, payload) {
      calls.push({ path, payload });
      return { code: 1 };
    },
  };
  const client = sdk.find({ roots: [vm] });
  await assert.rejects(() => client.gwPost('https://evil.example/api', {}), (error) => (
    error.code === 'LINGXING_INVALID_ARGUMENT' && error.details.requiresRelativePath === true
  ));
  await assert.rejects(() => client.gwPost('//evil.example/api', {}), /站内相对路径/);
  await assert.rejects(() => client.gwPost('api/list', {}), /站内相对路径/);
  await assert.rejects(() => client.gwPost('/api\\list', {}), /站内相对路径/);
  assert.equal(calls.length, 0);

  await client.gwPost('/api/list?offset=0', { ok: true });
  assert.equal(calls.length, 1);
});

test('request failures retain transport context and original cause', async () => {
  const cause = new Error('page interceptor rejected request');
  const vm = {
    $post() {
      throw cause;
    },
    $children: [],
  };
  const client = await sdk.connect({
    pageWindow: fakePage(vm),
    requiredTransports: ['post'],
    timeoutMs: 0,
  });

  await assert.rejects(
    client.post('/api/example', {}),
    (caught) => {
      assert.equal(caught.code, 'LINGXING_REQUEST_FAILED');
      assert.equal(caught.details.transport, 'post');
      assert.equal(caught.details.path, '/api/example');
      assert.equal(caught.cause, cause);
      return true;
    },
  );
});
