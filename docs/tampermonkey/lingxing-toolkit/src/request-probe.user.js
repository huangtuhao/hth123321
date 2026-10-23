// ==UserScript==
// @name         领星ERP-接口探针
// @namespace    local.lingxing.toolkit
// @version      1.1.0
// @description  统一显示领星自动化功能运行状态，并在手动开启时提供脱敏接口探针。
// @match        https://erp.lingxing.com/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// ==/UserScript==

/*__BRIDGE_CLIENT__*/

(function lingxingRequestProbe() {
  'use strict';

  const CLIENT_ID = 'userscript.lingxing.request-probe.v1';
  const TOKEN_KEY = 'lingxing_request_probe_bridge_token_v1';
  const ARTIFACT_BUCKET = 'lingxing_request_samples';
  const BRIDGE_URL = 'http://127.0.0.1:32145';
  const MAX_ENTRIES = 100;
  const MAX_SESSION_MS = 5 * 60 * 1000;
  const MAX_SANITIZED_BYTES = 4 * 1024 * 1024;
  const MAX_RESPONSE_TEXT = 2 * 1024 * 1024;
  const MAX_STRING = 1200;
  const HOST_ID = 'lingxing-request-probe-host-v1';
  const RUNTIME_REFRESH_MS = 20 * 1000;
  const SECRET_KEY = /(authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|cookie|password|passwd|secret|signature|credential|session[-_]?id|csrf|xsrf)/i;
  const PRIVATE_KEY = /(^|[-_])(phone|mobile|email|address|contact|buyer|customer|receiver|recipient|consignee|id[-_]?card|identity)([-_]|$)/i;
  const SAFE_HEADER_VALUE = /^(accept|content-type)$/i;
  const PROBE_JSON_CONTENT_TYPE = /^(?:application\/json|[^;\s]+\/[^;\s]+\+json)(?:\s*;|$)/i;
  const CAPTURE_HOSTS = new Set(['erp.lingxing.com', 'gw.lingxingerp.com']);
  const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
  const pageDocument = pageWindow.document || document;
  const xhrState = new WeakMap();
  const logicalStack = [];
  let patched = new WeakMap();

  const state = {
    recording: false,
    startedAt: null,
    stoppedAt: null,
    label: '',
    entries: [],
    logicalRestorers: [],
    scanTimer: null,
    ui: null,
    renderTimer: null,
    deadlineTimer: null,
    approxBytes: 0,
    sequence: 0,
    hookErrors: [],
    networkHooksInstalled: false,
    runtime: {
      bridge: 'checking',
      detailAccess: 'checking',
      summary: { online_clients: 0, online_instances: 0, running: 0, error: 0 },
      logicalClients: [],
      generatedAt: null,
      lastCheckedAt: null,
      errorMessage: '',
      refreshInFlight: false,
      refreshTimer: null,
    },
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function nextId(prefix) {
    state.sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${state.sequence.toString(36)}`;
  }

  function currentLogicalId() {
    return logicalStack.length ? logicalStack[logicalStack.length - 1] : null;
  }

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function isSensitiveKey(value) {
    const key = String(value || '');
    if (SECRET_KEY.test(key) || PRIVATE_KEY.test(key)) return true;
    const normalized = key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    if (!normalized) return false;
    if (
      normalized === 'token'
      || normalized === 'sid'
      || normalized.endsWith('token')
      || normalized.includes('authorization')
      || normalized.includes('apikey')
      || normalized.includes('sessionid')
      || normalized.includes('password')
      || normalized.includes('passwd')
      || normalized.includes('credential')
      || normalized.includes('signature')
    ) return true;
    return [
      'buyer', 'customer', 'receiver', 'recipient', 'consignee',
      'shippingaddress', 'deliveryaddress', 'contactname', 'contactphone',
      'mobilephone', 'phonenumber', 'emailaddress', 'idcard', 'identitynumber',
    ].some((term) => normalized.includes(term));
  }

  function truncate(value, max = MAX_STRING) {
    const text = String(value);
    const suspicious = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/i.test(text)
      || /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(text)
      || /\b[A-Fa-f0-9]{48,}\b/.test(text)
      || /\b[A-Za-z0-9+/=_-]{72,}\b/.test(text)
      || /\b1[3-9]\d{9}\b/.test(text)
      || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text);
    if (suspicious) return '[REDACTED_VALUE]';
    return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max}]`;
  }

  function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
      return value ?? null;
    }
    if (typeof value === 'string') return truncate(value);
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'function') return '[Function]';
    if (depth >= 7) return '[MaxDepth]';
    if (!isObject(value)) return truncate(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);

    const tag = Object.prototype.toString.call(value);
    if (tag === '[object Date]') return Number.isNaN(value.getTime()) ? '[InvalidDate]' : value.toISOString();
    if (tag === '[object ArrayBuffer]') return `[ArrayBuffer ${value.byteLength} bytes]`;
    if (/\[object (?:Uint|Int|Float|BigInt).*Array\]/.test(tag)) return `[${tag.slice(8, -1)} ${value.byteLength} bytes]`;
    if (tag === '[object Blob]' || tag === '[object File]') {
      return { type: value.type || '', size: Number(value.size) || 0, name: value.name ? truncate(value.name, 160) : undefined };
    }
    if (tag === '[object FormData]') {
      const output = Object.create(null);
      let count = 0;
      for (const [key, item] of value.entries()) {
        if (count >= 30) {
          output.__truncated__ = true;
          break;
        }
        output[key] = isSensitiveKey(key)
          ? '[REDACTED]'
          : sanitizeValue(item, depth + 1, seen);
        count += 1;
      }
      return output;
    }
    if (Array.isArray(value)) {
      const output = value.slice(0, 12).map((item) => sanitizeValue(item, depth + 1, seen));
      if (value.length > 12) output.push(`[+${value.length - 12} more]`);
      return output;
    }

    const output = Object.create(null);
    let count = 0;
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return `[${tag.slice(8, -1)}]`;
    }
    for (const key of keys) {
      if (count >= 60) {
        output.__truncated__ = true;
        break;
      }
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
      } else {
        try {
          output[key] = sanitizeValue(value[key], depth + 1, seen);
        } catch {
          output[key] = '[Unreadable]';
        }
      }
      count += 1;
    }
    return output;
  }

  function sanitizeUrl(rawUrl) {
    let parsed;
    try {
      parsed = new URL(String(rawUrl), pageWindow.location.href);
    } catch {
      return truncate(rawUrl, 1800);
    }
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
    }
    parsed.hash = '';
    return truncate(parsed.href, 2000);
  }

  function sanitizeLogicalPath(rawPath) {
    try {
      const text = String(rawPath);
      const parsed = new URL(text, pageWindow.location.href);
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (isSensitiveKey(key)) parsed.searchParams.set(key, '[REDACTED]');
      }
      parsed.hash = '';
      return truncate(/^[a-z][a-z0-9+.-]*:/i.test(text)
        ? parsed.href
        : `${parsed.pathname}${parsed.search}`, 1800);
    } catch {
      return truncate(rawPath, 1800);
    }
  }

  function sanitizeHeaders(input) {
    const output = Object.create(null);
    if (!input) return output;
    try {
      const headers = new pageWindow.Headers(input);
      headers.forEach((value, key) => {
        output[key] = SAFE_HEADER_VALUE.test(key) ? truncate(value, 300) : '[REDACTED]';
      });
    } catch {
      return { note: '[Unparseable headers]' };
    }
    return output;
  }

  function sanitizeRequestBody(body) {
    if (body === undefined || body === null) return null;
    if (typeof body !== 'string') return sanitizeValue(body);
    const trimmed = body.trim();
    if (!trimmed) return '';
    if (trimmed.length <= MAX_RESPONSE_TEXT && /^[\[{]/.test(trimmed)) {
      try {
        return sanitizeValue(JSON.parse(trimmed));
      } catch {
        // Keep a bounded plain-text sample below.
      }
    }
    if (trimmed.includes('=') && trimmed.length <= MAX_RESPONSE_TEXT) {
      try {
        const params = new URLSearchParams(trimmed);
        const parsed = Object.create(null);
        for (const [key, value] of params.entries()) {
          parsed[key] = isSensitiveKey(key) ? '[REDACTED]' : truncate(value);
        }
        return parsed;
      } catch {
        // Keep a bounded plain-text sample below.
      }
    }
    return `[Unstructured text body omitted: ${trimmed.length} chars]`;
  }

  async function readJsonTextLimited(response) {
    const clone = response.clone();
    if (!clone.body || typeof clone.body.getReader !== 'function') {
      const text = await clone.text();
      return text.length <= MAX_RESPONSE_TEXT
        ? { text, truncated: false, bytes: text.length }
        : { text: '', truncated: true, bytes: text.length };
    }
    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          text += decoder.decode();
          return { text, truncated: false, bytes };
        }
        bytes += value.byteLength;
        if (bytes > MAX_RESPONSE_TEXT) {
          await reader.cancel('probe response limit reached').catch(() => {});
          return { text: '', truncated: true, bytes };
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }
  }

  async function captureClonedRequestBody(entryId, request) {
    try {
      const method = String(request.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD' || !request.body) return;
      const contentType = request.headers?.get('content-type') || '';
      const supported = PROBE_JSON_CONTENT_TYPE.test(contentType)
        || /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(contentType);
      if (!supported) {
        updateEntry(entryId, { request_body: `[Request body omitted: ${truncate(contentType || 'unknown type', 120)}]` });
        return;
      }
      const sampled = await readJsonTextLimited(request);
      updateEntry(entryId, {
        request_body: sampled.truncated
          ? `[Request body omitted after exceeding ${MAX_RESPONSE_TEXT} bytes]`
          : sanitizeRequestBody(sampled.text),
      });
    } catch (error) {
      reportHookError('fetch Request body 采样', error);
    }
  }

  function shouldCaptureUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), pageWindow.location.href);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (!CAPTURE_HOSTS.has(host)) return false;
      return /(^|\/)api(\/|$)/i.test(url.pathname) || host.startsWith('gw.');
    } catch {
      return false;
    }
  }

  function addEntry(entry) {
    if (!state.recording) return null;
    if (state.entries.length >= MAX_ENTRIES || state.approxBytes >= MAX_SANITIZED_BYTES) {
      stopRecording('已达到会话容量上限，已自动停止；请审阅后保存。');
      return null;
    }
    const complete = {
      id: entry.id || nextId(entry.layer === 'logical' ? 'logical' : 'network'),
      observed_at: nowIso(),
      selected: false,
      ...entry,
    };
    state.entries.push(complete);
    state.approxBytes += estimateBytes(complete);
    scheduleRender();
    return complete;
  }

  function updateEntry(id, patch) {
    const entry = state.entries.find((item) => item.id === id);
    if (!entry) return;
    const before = estimateBytes(entry);
    Object.assign(entry, patch);
    state.approxBytes += Math.max(0, estimateBytes(entry) - before);
    if (state.recording && state.approxBytes >= MAX_SANITIZED_BYTES) {
      stopRecording('已达到 4 MiB 会话上限，已自动停止；请审阅后保存。');
    }
    scheduleRender();
  }

  function captureError(error) {
    return {
      name: typeof error?.name === 'string' ? truncate(error.name, 120) : 'Error',
      message: typeof error?.message === 'string' ? truncate(error.message, 800) : truncate(error, 800),
    };
  }

  function estimateBytes(value) {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 0;
    }
  }

  function reportHookError(scope, error) {
    try {
      const message = `${scope}: ${error?.message || String(error)}`.slice(0, 500);
      if (state.hookErrors.length < 20) state.hookErrors.push(message);
      console.warn(`[领星接口探针] ${scope} 观察失败，原业务请求继续执行`, error);
    } catch {
      // Monitoring failures must never affect the page request.
    }
  }

  function installNetworkHooks() {
    if (state.networkHooksInstalled) return;
    state.networkHooksInstalled = true;
    for (const [name, installer] of [['XHR', installXhrHook], ['fetch', installFetchHook]]) {
      try {
        installer();
      } catch (error) {
        reportHookError(`${name} hook 安装`, error);
      }
    }
  }

  function installXhrHook() {
    const Xhr = pageWindow.XMLHttpRequest;
    if (!Xhr?.prototype || Xhr.prototype.__lingxingRequestProbeV1) return;
    const prototype = Xhr.prototype;
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const originalSetHeader = prototype.setRequestHeader;

    Object.defineProperty(prototype, '__lingxingRequestProbeV1', { value: true, configurable: false });
    prototype.open = function probeXhrOpen(method, url, ...rest) {
      const result = Reflect.apply(originalOpen, this, [method, url, ...rest]);
      try {
        xhrState.set(this, {
          method: String(method || 'GET').toUpperCase(),
          url: sanitizeUrl(url),
          captureEligible: shouldCaptureUrl(url),
          headers: {},
        });
      } catch (error) {
        reportHookError('XHR.open', error);
      }
      return result;
    };
    prototype.setRequestHeader = function probeXhrHeader(name, value) {
      const result = Reflect.apply(originalSetHeader, this, [name, value]);
      try {
        const info = xhrState.get(this);
        if (info) {
          const headerName = String(name);
          info.headers[headerName] = SAFE_HEADER_VALUE.test(headerName) ? truncate(value, 300) : '[REDACTED]';
        }
      } catch (error) {
        reportHookError('XHR.setRequestHeader', error);
      }
      return result;
    };
    prototype.send = function probeXhrSend(body) {
      const info = xhrState.get(this);
      if (!state.recording || !info || !info.captureEligible) {
        return Reflect.apply(originalSend, this, [body]);
      }
      const startedAt = Date.now();
      let entry;
      try {
        entry = addEntry({
          layer: 'network',
          transport: 'xhr',
          logical_id: currentLogicalId(),
          method: info.method,
          url: sanitizeUrl(info.url),
          request_headers: sanitizeHeaders(info.headers),
          request_body: sanitizeRequestBody(body),
          response_type: truncate(this.responseType || 'text', 80),
          phase: 'pending',
        });
      } catch (error) {
        reportHookError('XHR.send 请求采样', error);
        return Reflect.apply(originalSend, this, [body]);
      }
      if (!entry) return Reflect.apply(originalSend, this, [body]);
      const finish = (phase) => {
        try {
          const patch = { phase, completed_at: nowIso(), duration_ms: Date.now() - startedAt, status: Number(this.status) || 0 };
          const type = this.getResponseHeader('content-type') || '';
          patch.response_content_type = truncate(type, 200);
          if (PROBE_JSON_CONTENT_TYPE.test(type) && typeof this.responseText === 'string') {
            patch.response = this.responseText.length <= MAX_RESPONSE_TEXT
              ? sanitizeRequestBody(this.responseText)
              : `[Response omitted: ${this.responseText.length} chars]`;
          } else if (this.response && typeof this.response === 'object') {
            patch.response = sanitizeValue(this.response);
          }
          updateEntry(entry.id, patch);
        } catch (error) {
          reportHookError('XHR 响应采样', error);
        }
      };
      try {
        this.addEventListener('load', () => finish('completed'), { once: true });
        this.addEventListener('error', () => finish('network_error'), { once: true });
        this.addEventListener('abort', () => finish('aborted'), { once: true });
        this.addEventListener('timeout', () => finish('timeout'), { once: true });
      } catch (error) {
        reportHookError('XHR 监听器安装', error);
      }
      return Reflect.apply(originalSend, this, [body]);
    };
  }

  function installFetchHook() {
    const originalFetch = pageWindow.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__lingxingRequestProbeV1) return;
    function probeFetch(input, init = undefined) {
      let requestUrl = '';
      let method = 'GET';
      let headers = null;
      let body = null;
      let requestClone = null;
      try {
        requestUrl = typeof input === 'string'
          ? input
          : (input && typeof input.url === 'string' ? input.url : String(input));
        method = String(init?.method || input?.method || 'GET').toUpperCase();
        headers = init?.headers || input?.headers || null;
        body = init?.body ?? null;
        if (body === null && input && typeof input.clone === 'function') requestClone = input.clone();
      } catch {
        // Leave safe defaults.
      }
      const captureEligible = state.recording && shouldCaptureUrl(requestUrl);
      const promise = Reflect.apply(originalFetch, this, [input, init]);
      if (!captureEligible) return promise;
      const startedAt = Date.now();
      let entry;
      try {
        entry = addEntry({
          layer: 'network',
          transport: 'fetch',
          logical_id: currentLogicalId(),
          method,
          url: sanitizeUrl(requestUrl),
          request_headers: sanitizeHeaders(headers),
          request_body: requestClone ? '[Request body pending]' : sanitizeRequestBody(body),
          phase: 'pending',
        });
      } catch (error) {
        reportHookError('fetch 请求采样', error);
        return promise;
      }
      if (!entry) return promise;
      if (requestClone) void captureClonedRequestBody(entry.id, requestClone);
      Promise.resolve(promise).then(async (response) => {
        const patch = {
          phase: 'completed',
          status: Number(response.status) || 0,
          duration_ms: Date.now() - startedAt,
          completed_at: nowIso(),
          response_content_type: truncate(response.headers?.get('content-type') || '', 200),
        };
        const lengthHeader = response.headers?.get('content-length');
        const length = lengthHeader === null || lengthHeader === undefined || lengthHeader === ''
          ? Number.NaN
          : Number(lengthHeader);
        if (PROBE_JSON_CONTENT_TYPE.test(patch.response_content_type) && (!Number.isFinite(length) || length <= MAX_RESPONSE_TEXT)) {
          try {
            const sampled = await readJsonTextLimited(response);
            patch.response = sampled.truncated
              ? `[JSON response omitted after exceeding ${MAX_RESPONSE_TEXT} bytes]`
              : sanitizeRequestBody(sampled.text);
          } catch {
            patch.response = '[Unreadable response]';
          }
        } else if (Number.isFinite(length)) {
          patch.response = `[Response body omitted: ${length} bytes]`;
        }
        updateEntry(entry.id, patch);
      }, (error) => {
        updateEntry(entry.id, { phase: 'network_error', duration_ms: Date.now() - startedAt, error: captureError(error), completed_at: nowIso() });
      }).catch(() => {});
      return promise;
    }
    Object.defineProperty(probeFetch, '__lingxingRequestProbeV1', { value: true });
    pageWindow.fetch = probeFetch;
  }

  function findPropertyOwner(target, key) {
    let cursor = target;
    for (let depth = 0; cursor && depth < 14; depth += 1) {
      try {
        if (Object.prototype.hasOwnProperty.call(cursor, key)) return cursor;
        cursor = Object.getPrototypeOf(cursor);
      } catch {
        return null;
      }
    }
    return null;
  }

  function alreadyPatched(owner, key) {
    let keys = patched.get(owner);
    if (!keys) {
      keys = new Set();
      patched.set(owner, keys);
    }
    if (keys.has(key)) return true;
    keys.add(key);
    return false;
  }

  function forgetPatched(owner, key) {
    const keys = patched.get(owner);
    if (!keys) return;
    keys.delete(key);
  }

  function describeLogicalCall(transport, args) {
    if (transport === 'post') {
      return {
        method: 'POST',
        path: args[0],
        payload: args[1],
        request_config: args[2],
        arg4: args[3],
        arg5: args[4],
        sequence_group: args[5] ?? null,
      };
    }
    if (transport === 'gwPost') {
      return { method: 'POST', path: args[0], payload: args[1], request_config: args[2] };
    }
    if (transport === 'gateGet') return { method: 'GET', path: args[0], config: args[1] };
    return { method: 'POST', path: args[0], payload: args[1], config: args[2] };
  }

  function patchMethod(receiver, key, transport) {
    const owner = findPropertyOwner(receiver, key);
    if (!owner) return false;
    let descriptor;
    let original;
    try {
      descriptor = Object.getOwnPropertyDescriptor(owner, key);
      original = receiver[key];
    } catch {
      return false;
    }
    if (typeof original !== 'function') return false;
    const patchOwner = descriptor && 'value' in descriptor ? owner : receiver;
    if (alreadyPatched(patchOwner, key)) return false;
    let patchDescriptor;
    try {
      patchDescriptor = Object.getOwnPropertyDescriptor(patchOwner, key);
    } catch {
      forgetPatched(patchOwner, key);
      return false;
    }

    function logicalWrapper(...args) {
      if (!state.recording) return Reflect.apply(original, this, args);
      let entry;
      try {
        const detail = describeLogicalCall(transport, args);
        entry = addEntry({
          layer: 'logical',
          transport,
          method: detail.method,
          path: sanitizeLogicalPath(detail.path),
          payload: sanitizeValue(detail.payload),
          config: sanitizeValue(detail.config),
          request_config: sanitizeValue(detail.request_config),
          arg4: sanitizeValue(detail.arg4),
          arg5: sanitizeValue(detail.arg5),
          sequence_group: detail.sequence_group === undefined ? null : sanitizeValue(detail.sequence_group),
          phase: 'pending',
        });
      } catch (error) {
        reportHookError(`${transport} 请求采样`, error);
        return Reflect.apply(original, this, args);
      }
      if (!entry) return Reflect.apply(original, this, args);
      logicalStack.push(entry.id);
      let result;
      try {
        result = Reflect.apply(original, this, args);
      } catch (error) {
        try {
          updateEntry(entry.id, { phase: 'error', error: captureError(error), completed_at: nowIso() });
        } catch (captureFailure) {
          reportHookError(`${transport} 同步错误采样`, captureFailure);
        }
        throw error;
      } finally {
        logicalStack.pop();
      }
      Promise.resolve(result).then(
        (value) => updateEntry(entry.id, { phase: 'completed', response: sanitizeValue(value), completed_at: nowIso() }),
        (error) => updateEntry(entry.id, { phase: 'error', error: captureError(error), completed_at: nowIso() }),
      ).catch((error) => reportHookError(`${transport} 响应采样`, error));
      return result;
    }

    try {
      if (patchDescriptor && 'value' in patchDescriptor) {
        Object.defineProperty(patchOwner, key, { ...patchDescriptor, value: logicalWrapper });
      } else {
        Object.defineProperty(patchOwner, key, {
          configurable: true,
          enumerable: patchDescriptor?.enumerable ?? true,
          writable: true,
          value: logicalWrapper,
        });
      }
    } catch {
      forgetPatched(patchOwner, key);
      return false;
    }
    state.logicalRestorers.push(() => {
      try {
        const current = Object.getOwnPropertyDescriptor(patchOwner, key);
        if (!current || !('value' in current) || current.value !== logicalWrapper) {
          forgetPatched(patchOwner, key);
          return;
        }
        if (patchDescriptor) Object.defineProperty(patchOwner, key, patchDescriptor);
        else delete patchOwner[key];
      } catch {
        // Page navigation may have disposed this object.
      } finally {
        forgetPatched(patchOwner, key);
      }
    });
    return true;
  }

  function collectVueInstances() {
    const roots = [];
    const seenRoots = new Set();
    const selectors = ['#app', '.app-wrapper', '.el-main', '[data-v-app]'];
    for (const selector of selectors) {
      let nodes = [];
      try { nodes = Array.from(pageDocument.querySelectorAll(selector)); } catch { /* noop */ }
      for (const node of nodes) {
        const vm = node?.__vue__ || node?.__vueParentComponent?.proxy;
        if (vm && !seenRoots.has(vm)) {
          seenRoots.add(vm);
          roots.push(vm);
        }
      }
    }
    if (roots.length === 0) {
      let scanned = 0;
      for (const node of pageDocument.querySelectorAll('*')) {
        scanned += 1;
        if (scanned > 1800) break;
        const vm = node?.__vue__ || node?.__vueParentComponent?.proxy;
        if (vm && !seenRoots.has(vm)) {
          seenRoots.add(vm);
          roots.push(vm);
        }
      }
    }

    const queue = roots.slice();
    const found = [];
    const seen = new Set();
    while (queue.length && found.length < 800) {
      const vm = queue.shift();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      found.push(vm);
      try {
        if (Array.isArray(vm.$children)) queue.push(...vm.$children);
        if (vm.$parent) queue.push(vm.$parent);
        if (vm.$root) queue.push(vm.$root);
      } catch {
        // Ignore disposed Vue nodes.
      }
    }
    return found;
  }

  function scanAndPatchLogicalClients() {
    if (!state.recording) return;
    for (const vm of collectVueInstances()) {
      try {
        if (typeof vm.$post === 'function') patchMethod(vm, '$post', 'post');
        if (typeof vm.$gwPost === 'function') patchMethod(vm, '$gwPost', 'gwPost');
        const gate = vm.$gateAxios;
        if (gate && typeof gate.get === 'function') patchMethod(gate, 'get', 'gateGet');
        if (gate && typeof gate.post === 'function') patchMethod(gate, 'post', 'gatePost');
      } catch {
        // Continue scanning other Vue nodes.
      }
    }
  }

  function restoreLogicalClients() {
    if (state.scanTimer) pageWindow.clearInterval(state.scanTimer);
    state.scanTimer = null;
    for (const restore of state.logicalRestorers.splice(0).reverse()) restore();
    patched = new WeakMap();
  }

  function startRecording() {
    if (state.recording) return;
    if (state.entries.length > 0) {
      const confirmed = confirm('开始新记录会清空上一轮尚未保存的请求。确定继续吗？');
      if (!confirmed) return;
      state.entries.splice(0);
      state.approxBytes = 0;
    }
    installNetworkHooks();
    state.label = state.ui?.label?.value?.trim() || '';
    state.recording = true;
    state.startedAt = nowIso();
    state.stoppedAt = null;
    state.deadlineTimer = pageWindow.setTimeout(() => {
      stopRecording('已记录 5 分钟，自动停止；不会自动保存。');
    }, MAX_SESSION_MS);
    scanAndPatchLogicalClients();
    state.scanTimer = pageWindow.setInterval(scanAndPatchLogicalClients, 1500);
    scheduleRender();
  }

  function stopRecording(reason = '') {
    if (!state.recording) return;
    state.recording = false;
    state.stoppedAt = nowIso();
    if (state.deadlineTimer) pageWindow.clearTimeout(state.deadlineTimer);
    state.deadlineTimer = null;
    restoreLogicalClients();
    if (reason) setStatus(reason);
    scheduleRender();
  }

  function clearEntries() {
    if (state.recording && !confirm('正在记录。确定清空当前样本吗？')) return;
    state.entries.splice(0);
    state.approxBytes = 0;
    state.startedAt = state.recording ? nowIso() : null;
    state.stoppedAt = null;
    scheduleRender();
  }

  function selectedEntries() {
    return state.entries.filter((entry) => entry.selected).map((entry) => {
      const copy = { ...entry };
      delete copy.selected;
      return sanitizeValue(copy);
    });
  }

  function availableTransports() {
    return Array.from(new Set(state.entries.filter((item) => item.layer === 'logical').map((item) => item.transport))).sort();
  }

  function buildEvidence() {
    const requests = selectedEntries();
    if (!requests.length) throw new Error('请至少选择一条请求。');
    return {
      schema_version: 'lingxing-request-evidence/1',
      captured_at: nowIso(),
      label: truncate(state.ui?.label?.value?.trim() || state.label || '', 160),
      page: { url: sanitizeUrl(pageWindow.location.href), title: truncate(pageDocument.title || '', 300) },
      capture: {
        started_at: state.startedAt,
        stopped_at: state.stoppedAt || (state.recording ? null : nowIso()),
        selected_count: requests.length,
        total_observed: state.entries.length,
      },
      client_environment: { available_transports: availableTransports() },
      privacy: {
        credentials: 'redacted',
        common_contact_fields: 'redacted',
        arrays_sampled_to: 12,
        strings_truncated_to: MAX_STRING,
        session_limits: { max_seconds: MAX_SESSION_MS / 1000, max_requests: MAX_ENTRIES, max_sanitized_bytes: MAX_SANITIZED_BYTES },
      },
      requests,
    };
  }

  function safeFilename(label) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
    const suffix = (label || '未命名样本').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 80) || '未命名样本';
    return `${stamp}-${suffix}.json`;
  }

  function encodeJsonBuffer(value) {
    const bytes = new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  function createBridge() {
    return globalThis.LocalAutomationBridge.createLocalBridgeClient({
      clientId: CLIENT_ID,
      baseUrl: BRIDGE_URL,
      tokenKey: TOKEN_KEY,
    });
  }

  async function pairBridge() {
    const code = prompt('请在本地桥生成一次性配对码，然后粘贴到这里：');
    if (!code) return;
    setStatus('正在配对…');
    const result = await createBridge().pair(code.trim());
    setStatus(`配对成功（${result.permissions.length} 项权限）`, 'ok');
    await refreshRuntimeStatus();
  }

  async function saveToBridge() {
    const evidence = buildEvidence();
    const bridge = createBridge();
    setStatus('正在检查本地桥权限…');
    const capabilities = await bridge.capabilities();
    const buckets = capabilities.resources?.artifact_buckets;
    const requiredPermission = `artifact:write:${ARTIFACT_BUCKET}`;
    if (
      !Array.isArray(capabilities.permissions)
      || !capabilities.permissions.includes(requiredPermission)
      || !Array.isArray(buckets)
      || !buckets.some((item) => item.id === ARTIFACT_BUCKET)
    ) {
      throw new Error(`当前客户端没有 ${ARTIFACT_BUCKET} 写入权限，请检查桥配置并重新配对。`);
    }
    const filename = safeFilename(evidence.label);
    setStatus(`正在保存 ${filename}…`);
    const result = await bridge.uploadArtifact(
      ARTIFACT_BUCKET,
      filename,
      encodeJsonBuffer(evidence),
      'application/json; charset=UTF-8',
    );
    const saved = result.artifact?.path || result.artifact?.filename || filename;
    setStatus(`已保存：${saved}`, 'ok');
  }

  function downloadEvidence() {
    const evidence = buildEvidence();
    const blob = new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: 'application/json;charset=UTF-8' });
    const url = URL.createObjectURL(blob);
    const anchor = pageDocument.createElement('a');
    anchor.href = url;
    anchor.download = safeFilename(evidence.label);
    anchor.style.display = 'none';
    pageDocument.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('样本已交给浏览器下载', 'ok');
  }

  function nonNegativeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  }

  function normalizeRuntimeSummary(value) {
    const summary = isObject(value?.summary) ? value.summary : (isObject(value) ? value : {});
    return {
      online_clients: nonNegativeInteger(summary.online_clients),
      online_instances: nonNegativeInteger(summary.online_instances),
      running: nonNegativeInteger(summary.running),
      error: nonNegativeInteger(summary.error),
    };
  }

  function compactRuntimeText() {
    const runtime = state.runtime;
    if (runtime.bridge === 'checking') return '◌ 正在检查';
    if (runtime.bridge === 'offline') return '● 本地桥离线';
    const { online_clients: online, running, error } = runtime.summary;
    if (error > 0) return `● ${online} 在线 · ${error} 异常`;
    if (running > 0) return `● ${online} 在线 · ${running} 运行`;
    return `● ${online} 在线 · 空闲`;
  }

  function runtimeTone() {
    if (state.runtime.bridge === 'checking') return 'checking';
    if (state.runtime.bridge === 'offline') return 'offline';
    if (state.runtime.summary.error > 0) return 'error';
    if (state.runtime.summary.running > 0) return 'running';
    return 'online';
  }

  function runtimeDetailHint() {
    const runtime = state.runtime;
    if (runtime.bridge === 'offline') return runtime.errorMessage || '请确认 Windows 本地桥服务已启动。';
    if (runtime.detailAccess === 'pairing_required') return '本地桥已在线。当前中心尚未配对，只能显示匿名汇总；配对后可查看每个功能明细。';
    if (runtime.detailAccess === 'permission_denied') return '本地桥已在线，但当前客户端缺少 runtime:read 权限；更新桥配置后请重新配对。';
    if (runtime.detailAccess === 'unsupported') return '本地桥已在线，但当前版本还不支持运行状态明细。';
    if (runtime.detailAccess === 'error') return `本地桥已在线，读取明细失败：${runtime.errorMessage || '未知错误'}`;
    if (runtime.detailAccess === 'checking') return '正在读取运行状态…';
    if (runtime.logicalClients.length === 0) return '本地桥已在线，当前没有已登记的浏览器功能。';
    return '';
  }

  function formatRuntimeTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  }

  async function refreshRuntimeStatus() {
    const runtime = state.runtime;
    if (runtime.refreshInFlight) return;
    runtime.refreshInFlight = true;
    if (runtime.bridge !== 'online') runtime.bridge = 'checking';
    runtime.detailAccess = 'checking';
    scheduleRender();
    try {
      const bridge = createBridge();
      const health = await bridge.health();
      runtime.bridge = 'online';
      runtime.summary = normalizeRuntimeSummary(health.runtime_summary);
      runtime.errorMessage = '';
      if (typeof bridge.runtimeStatus !== 'function') {
        runtime.detailAccess = 'unsupported';
        runtime.logicalClients = [];
      } else {
        try {
          const result = await bridge.runtimeStatus();
          const snapshot = result?.runtime;
          if (!isObject(snapshot) || !Array.isArray(snapshot.logical_clients)) {
            throw new Error('运行状态响应缺少 runtime.logical_clients');
          }
          runtime.summary = normalizeRuntimeSummary(snapshot.summary);
          runtime.logicalClients = snapshot.logical_clients.filter(isObject);
          runtime.generatedAt = typeof snapshot.generated_at === 'string' ? snapshot.generated_at : null;
          runtime.detailAccess = 'ready';
        } catch (error) {
          runtime.logicalClients = [];
          runtime.errorMessage = error?.message || String(error);
          if (error?.requiresPairing || error?.code === 'PAIRING_REQUIRED') {
            runtime.detailAccess = 'pairing_required';
          } else if (error?.status === 403 || error?.code === 'PERMISSION_DENIED') {
            runtime.detailAccess = 'permission_denied';
          } else if (error?.status === 404 || error?.code === 'NOT_FOUND') {
            runtime.detailAccess = 'unsupported';
          } else {
            runtime.detailAccess = 'error';
          }
        }
      }
    } catch (error) {
      runtime.bridge = 'offline';
      runtime.detailAccess = 'unavailable';
      runtime.summary = normalizeRuntimeSummary(null);
      runtime.logicalClients = [];
      runtime.generatedAt = null;
      runtime.errorMessage = error?.message || String(error);
    } finally {
      runtime.lastCheckedAt = nowIso();
      runtime.refreshInFlight = false;
      scheduleRender();
    }
  }

  function setStatus(message, kind = '') {
    if (!state.ui?.status) return;
    state.ui.status.textContent = message;
    state.ui.status.dataset.kind = kind;
  }

  function scheduleRender() {
    if (state.renderTimer) return;
    state.renderTimer = pageWindow.setTimeout(() => {
      state.renderTimer = null;
      render();
    }, 120);
  }

  function shortTarget(entry) {
    const value = entry.path || entry.url || '';
    try {
      const parsed = new URL(value, pageWindow.location.href);
      return `${parsed.pathname}${parsed.search}`.slice(0, 100);
    } catch {
      return String(value).slice(0, 100);
    }
  }

  function renderRuntime() {
    if (!state.ui) return;
    const runtime = state.runtime;
    const summary = runtime.summary;
    const tone = runtimeTone();
    state.ui.compact.textContent = compactRuntimeText();
    state.ui.compact.dataset.tone = tone;
    state.ui.bridgeState.textContent = runtime.bridge === 'online'
      ? '在线'
      : (runtime.bridge === 'checking' ? '检查中' : '离线');
    state.ui.bridgeState.dataset.tone = tone;
    state.ui.onlineClients.textContent = String(summary.online_clients);
    state.ui.onlineInstances.textContent = String(summary.online_instances);
    state.ui.runningCount.textContent = String(summary.running);
    state.ui.errorCount.textContent = String(summary.error);
    state.ui.runtimeUpdated.textContent = runtime.lastCheckedAt
      ? `最后检查 ${formatRuntimeTime(runtime.lastCheckedAt)}`
      : '等待首次检查';
    const hint = runtimeDetailHint();
    state.ui.runtimeHint.textContent = hint;
    state.ui.runtimeHint.hidden = !hint;

    const fragment = pageDocument.createDocumentFragment();
    for (const client of runtime.logicalClients) {
      const row = pageDocument.createElement('div');
      row.className = 'runtime-client';
      row.dataset.state = client.online === false ? 'offline' : String(client.state || 'idle');
      const main = pageDocument.createElement('div');
      main.className = 'runtime-client-main';
      const name = pageDocument.createElement('strong');
      name.textContent = String(client.name || client.client_id || '未命名功能');
      const badge = pageDocument.createElement('span');
      badge.className = 'runtime-badge';
      const clientState = client.online === false ? 'offline' : String(client.state || 'idle');
      badge.dataset.state = clientState;
      badge.textContent = {
        idle: '空闲',
        running: '运行中',
        error: '异常',
        offline: '未激活',
      }[clientState] || clientState;
      main.append(name, badge);
      const meta = pageDocument.createElement('div');
      meta.className = 'runtime-client-meta';
      const instances = Array.isArray(client.instances) ? client.instances.length : 0;
      const capabilities = Array.isArray(client.capabilities)
        ? client.capabilities.map((item) => String(item?.name || item?.id || '')).filter(Boolean)
        : [];
      meta.textContent = `${instances} 个页面实例 · 最后心跳 ${formatRuntimeTime(client.last_seen_at)}`;
      const capabilityText = pageDocument.createElement('div');
      capabilityText.className = 'runtime-capabilities';
      capabilityText.textContent = capabilities.length ? capabilities.join('、') : '未声明功能';
      const instancesForMessage = Array.isArray(client.instances) ? client.instances : [];
      const activeInstance = instancesForMessage.find((item) => item?.state === clientState && item?.message)
        || instancesForMessage.find((item) => item?.message);
      const message = pageDocument.createElement('div');
      message.className = 'runtime-message';
      message.textContent = activeInstance?.message ? String(activeInstance.message) : '';
      message.hidden = !message.textContent;
      row.append(main, meta, capabilityText, message);
      fragment.appendChild(row);
    }
    state.ui.runtimeList.replaceChildren(fragment);
  }

  function render() {
    if (!state.ui) return;
    renderRuntime();
    state.ui.mode.textContent = state.recording ? '● 正在记录' : '○ 已停止';
    state.ui.mode.dataset.recording = state.recording ? 'true' : 'false';
    state.ui.start.disabled = state.recording;
    state.ui.stop.disabled = !state.recording;
    state.ui.count.textContent = `${state.entries.length} 条（已选 ${state.entries.filter((item) => item.selected).length}）`;
    const fragment = pageDocument.createDocumentFragment();
    const visible = state.entries.slice().reverse();
    for (const entry of visible) {
      const row = pageDocument.createElement('label');
      row.className = 'row';
      row.title = shortTarget(entry);
      const checkbox = pageDocument.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = entry.selected;
      checkbox.addEventListener('change', () => {
        entry.selected = checkbox.checked;
        scheduleRender();
      });
      const badge = pageDocument.createElement('span');
      badge.className = `badge ${entry.layer}`;
      badge.textContent = entry.transport;
      const target = pageDocument.createElement('span');
      target.className = 'target';
      target.textContent = `${entry.method || ''} ${shortTarget(entry)}`;
      const phase = pageDocument.createElement('span');
      phase.className = 'phase';
      phase.textContent = entry.status ? String(entry.status) : entry.phase || '';
      row.append(checkbox, badge, target, phase);
      row.addEventListener('dblclick', () => {
        state.ui.preview.textContent = JSON.stringify(sanitizeValue(entry), null, 2);
        state.ui.preview.hidden = false;
      });
      fragment.appendChild(row);
    }
    state.ui.list.replaceChildren(fragment);
  }

  function bindAsync(button, task) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await task();
      } catch (error) {
        console.error('[领星接口探针]', error);
        setStatus(error?.message || String(error), 'error');
      } finally {
        button.disabled = false;
        scheduleRender();
      }
    });
  }

  function installDrag(handle, host) {
    let start = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.target?.closest?.('button,input,summary')) return;
      const rect = host.getBoundingClientRect();
      start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!start) return;
      host.style.left = `${Math.max(0, Math.min(pageWindow.innerWidth - 80, start.left + event.clientX - start.x))}px`;
      host.style.top = `${Math.max(0, Math.min(pageWindow.innerHeight - 42, start.top + event.clientY - start.y))}px`;
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', (event) => {
      if (!start) return;
      start = null;
      try { handle.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      const rect = host.getBoundingClientRect();
      const top = Math.max(8, Math.min(pageWindow.innerHeight - Math.min(rect.height, 60) - 8, rect.top));
      host.style.top = `${top}px`;
      host.style.bottom = 'auto';
      if (rect.left + rect.width / 2 < pageWindow.innerWidth / 2) {
        host.style.left = '12px';
        host.style.right = 'auto';
      } else {
        host.style.left = 'auto';
        host.style.right = '12px';
      }
    });
  }

  function createUi() {
    if (!pageDocument.documentElement || pageDocument.getElementById(HOST_ID)) return;
    const host = pageDocument.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;left:12px;bottom:92px;z-index:2147483646;font:13px/1.4 system-ui,"Microsoft YaHei",sans-serif;color:#17202a;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box}button,input{font:inherit}.panel{width:460px;max-height:min(78vh,760px);background:#fff;border:1px solid #cfd7df;border-radius:11px;box-shadow:0 8px 28px #0003;overflow:hidden}.panel.collapsed{width:auto;min-width:218px;border-radius:999px}.head{display:flex;align-items:center;gap:8px;padding:9px 10px;background:#0e3a5d;color:#fff;cursor:move;user-select:none}.collapsed .head{border-radius:999px;padding:7px 8px 7px 12px}.title{font-weight:700;white-space:nowrap}.compact{flex:1;color:#dce7ef;font-size:12px;white-space:nowrap}.compact[data-tone="online"]{color:#a7f3cf}.compact[data-tone="running"]{color:#9fdbff}.compact[data-tone="error"]{color:#ffd08a}.compact[data-tone="offline"]{color:#ffb2aa}.collapsed .title{display:none}.collapsed .compact{font-weight:650}.icon{border:0;background:#ffffff20;color:#fff;border-radius:5px;width:27px;height:25px;cursor:pointer}.collapsed .icon{border-radius:999px}.body{padding:10px;overflow:auto;max-height:calc(min(78vh,760px) - 44px)}.collapsed .body{display:none}.runtime-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.runtime-card{padding:8px;border:1px solid #dfe6ec;border-radius:7px;background:#f8fafc}.runtime-card span{display:block;color:#71808b;font-size:11px}.runtime-card strong{display:block;margin-top:2px;font-size:16px}.runtime-card strong[data-tone="online"]{color:#18794e}.runtime-card strong[data-tone="running"]{color:#0f6ca6}.runtime-card strong[data-tone="error"],.runtime-card strong[data-tone="offline"]{color:#b42318}.runtime-sub{font-size:10px;color:#87939c;margin-top:1px}.runtime-list{margin-top:8px;border:1px solid #dfe5ea;border-radius:7px;max-height:240px;overflow:auto}.runtime-client{padding:7px 8px;border-bottom:1px solid #edf1f4}.runtime-client:last-child{border-bottom:0}.runtime-client-main{display:flex;align-items:center;gap:7px}.runtime-client-main strong{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.runtime-badge{font-size:10px;border-radius:999px;padding:2px 7px;background:#e7f4ed;color:#18794e}.runtime-badge[data-state="running"]{background:#e0f1fb;color:#0f6ca6}.runtime-badge[data-state="error"]{background:#ffebe9;color:#b42318}.runtime-badge[data-state="offline"]{background:#eef1f4;color:#6b7780}.runtime-client-meta,.runtime-capabilities{font-size:11px;color:#71808b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.runtime-message{font-size:11px;color:#344b5d;margin-top:3px;overflow-wrap:anywhere}.runtime-client[data-state="error"] .runtime-message{color:#b42318}.runtime-client[data-state="running"] .runtime-message{color:#0f6ca6}.runtime-hint{margin-top:8px;padding:8px;border-radius:6px;background:#f5f7f9;color:#5e6d79}.runtime-footer{display:flex;justify-content:space-between;gap:8px;margin-top:7px;color:#7a8790;font-size:11px}.advanced{margin-top:10px;border-top:1px solid #dfe5ea;padding-top:8px}.advanced>summary{cursor:pointer;font-weight:650;color:#344b5d;list-style:none}.advanced>summary::-webkit-details-marker{display:none}.advanced>summary:before{content:'▸';display:inline-block;margin-right:5px}.advanced[open]>summary:before{content:'▾'}.mode{float:right;font-size:11px;color:#71808b}.mode[data-recording="true"]{color:#b36b00}.probe-body{padding-top:9px}.label{display:flex;gap:7px;align-items:center;margin-bottom:8px}.label input{min-width:0;flex:1;border:1px solid #cdd7df;border-radius:5px;padding:5px 7px}.tools{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.tools button{border:1px solid #b8c6d1;background:#f7fafc;border-radius:5px;padding:5px 8px;cursor:pointer}.tools button.primary{background:#0f6ca6;color:#fff;border-color:#0f6ca6}.tools button.danger{color:#a72828}.tools button:disabled{opacity:.45;cursor:not-allowed}.meta{display:flex;justify-content:space-between;color:#5e6d79;margin:5px 0}.list{border:1px solid #dfe5ea;border-radius:5px;max-height:240px;overflow:auto}.row{display:grid;grid-template-columns:18px 64px 1fr 42px;align-items:center;gap:5px;padding:5px 6px;border-bottom:1px solid #edf1f4;cursor:pointer}.row:last-child{border-bottom:0}.row:hover{background:#f4f8fb}.badge{font-size:11px;border-radius:4px;padding:2px 4px;text-align:center;background:#e8eef3;overflow:hidden}.badge.logical{background:#d8efff;color:#07527d}.badge.network{background:#eee4ff;color:#573383}.target{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.phase{text-align:right;color:#65737e;font-size:11px}.probe-status{min-height:19px;color:#65737e;margin-top:7px;overflow-wrap:anywhere}.probe-status[data-kind="ok"]{color:#18794e}.probe-status[data-kind="error"]{color:#b42318}.hint{color:#71808b;font-size:11px;margin-top:5px}.preview{white-space:pre-wrap;max-height:190px;overflow:auto;background:#101820;color:#d9e4ec;padding:7px;border-radius:5px;margin-top:7px;font:11px/1.35 Consolas,monospace}
      </style>
      <section class="panel collapsed">
        <header class="head"><span class="title">领星自动化中心</span><span class="compact" data-tone="checking">◌ 正在检查</span><button class="icon collapse" title="收起/展开">+</button><button class="icon close" title="完全隐藏">×</button></header>
        <div class="body">
          <section class="runtime-section">
            <div class="runtime-overview">
              <div class="runtime-card"><span>本地桥</span><strong class="bridge-state">检查中</strong></div>
              <div class="runtime-card"><span>在线功能</span><strong class="online-clients">0</strong><div class="runtime-sub"><span class="online-instances">0</span> 个页面实例</div></div>
              <div class="runtime-card"><span>运行中</span><strong class="running-count">0</strong></div>
              <div class="runtime-card"><span>异常</span><strong class="error-count">0</strong></div>
            </div>
            <div class="runtime-list"></div>
            <div class="runtime-hint">正在读取运行状态…</div>
            <div class="runtime-footer"><span>按功能去重，多标签页只计 1 个在线功能</span><span class="runtime-updated">等待首次检查</span></div>
          </section>
          <details class="advanced">
            <summary>接口探针（高级工具）<span class="mode">○ 已停止</span></summary>
            <div class="probe-body">
              <label class="label"><span>样本说明</span><input class="label-input" maxlength="80" placeholder="例如：产品列表第一页"></label>
              <div class="tools"><button class="primary start">开始记录</button><button class="stop" disabled>停止</button><button class="clear danger">清空</button><button class="pair">桥接配对</button><button class="save">保存到本地</button><button class="download">下载 JSON</button></div>
              <div class="meta"><span>双击一行预览</span><span class="count">0 条</span></div>
              <div class="list"></div>
              <pre class="preview" hidden></pre>
              <div class="probe-status">待命。开始后请在页面完成一次目标操作。</div>
              <div class="hint">探针默认不记录；仅在你手动点击“开始记录”后观察，保存前会脱敏。它不会重放请求、自动翻页或修改业务数据。</div>
            </div>
          </details>
        </div>
      </section>`;
    pageDocument.documentElement.appendChild(host);
    const pick = (selector) => shadow.querySelector(selector);
    state.ui = {
      host,
      panel: pick('.panel'),
      compact: pick('.compact'),
      bridgeState: pick('.bridge-state'),
      onlineClients: pick('.online-clients'),
      onlineInstances: pick('.online-instances'),
      runningCount: pick('.running-count'),
      errorCount: pick('.error-count'),
      runtimeList: pick('.runtime-list'),
      runtimeHint: pick('.runtime-hint'),
      runtimeUpdated: pick('.runtime-updated'),
      mode: pick('.mode'),
      start: pick('.start'),
      stop: pick('.stop'),
      clear: pick('.clear'),
      pair: pick('.pair'),
      save: pick('.save'),
      download: pick('.download'),
      label: pick('.label-input'),
      count: pick('.count'),
      list: pick('.list'),
      preview: pick('.preview'),
      status: pick('.probe-status'),
    };
    state.ui.start.addEventListener('click', startRecording);
    state.ui.stop.addEventListener('click', () => stopRecording());
    state.ui.clear.addEventListener('click', clearEntries);
    bindAsync(state.ui.pair, pairBridge);
    bindAsync(state.ui.save, saveToBridge);
    bindAsync(state.ui.download, downloadEvidence);
    pick('.collapse').addEventListener('click', (event) => {
      const collapsed = state.ui.panel.classList.toggle('collapsed');
      event.currentTarget.textContent = collapsed ? '+' : '—';
    });
    pick('.close').addEventListener('click', () => {
      if (state.recording) stopRecording('面板已关闭，本轮记录已停止。');
      host.style.display = 'none';
    });
    installDrag(pick('.head'), host);
    render();
    void refreshRuntimeStatus();
    if (!state.runtime.refreshTimer) {
      state.runtime.refreshTimer = pageWindow.setInterval(() => void refreshRuntimeStatus(), RUNTIME_REFRESH_MS);
    }
    if (state.hookErrors.length) {
      setStatus(`部分网络监听未安装：${state.hookErrors.join('；')}。逻辑层仍会尝试记录。`, 'error');
    }
  }

  function showUi() {
    if (!state.ui) createUi();
    if (state.ui) {
      state.ui.host.style.display = '';
      void refreshRuntimeStatus();
    }
  }

  if (pageDocument.readyState === 'loading') {
    pageDocument.addEventListener('DOMContentLoaded', createUi, { once: true });
  } else {
    createUi();
  }
  GM_registerMenuCommand('领星自动化中心：显示状态栏', showUi);
}());
