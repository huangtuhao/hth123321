// ==UserScript==
// @name         领星ERP-产品库采集助手
// @namespace    local.lingxing.products
// @version      1.3.0
// @description  采集领星「产品管理 → 产品列表」全量产品库，经本地自动化桥落盘到 products 数据集；支持每日定时/间隔自动采集，并作为 lingxing.products.refresh 在线执行者供 AI 触发刷新。油猴菜单只留一个入口，功能都在页面面板里。
// @author       WorkBuddy
// @match        https://erp.lingxing.com/*
// @run-at       document-idle
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      127.0.0.1
// ==/UserScript==

/*
 * 请求证据（2026-10-21 15:42 接口探针，页面 /erp/productManage）：
 *   logical 层 transport = post
 *   path = /api/product/lists
 *   sequence_group = "request"
 *   响应结构 = { code, msg, total, list }（扁平，不是 data.list）
 * 传输层固定为 post，禁止回退到 gwPost / gateGet / 裸 fetch。
 * 采全量：筛选条件与页面首屏一致且全为空；只有 full scope 才覆盖基线。
 *
 * 运行位置：任意 erp.lingxing.com 页面都可以（$post 挂在 Vue 根实例上，不依赖具体路由）。
 *
 * 界面（1.2.1 起）：
 *   页面加载时**不注入任何 DOM**，不常驻图标，避免遮挡领星页面内容。
 *   油猴菜单只有一条「显示功能面板」，点开才创建面板，点 × 直接从 DOM 移除。
 *   面板承载：状态、立即采集、自动采集设置、配对、账号标识、诊断。
 *   状态提示条在左下角，只在有动作时短暂出现。
 *
 * 自动采集（两种模式，默认关闭）：
 *   - 每天定时：到点后当天成功过就不再跑；到点时页面没开，下次打开领星页会补跑（当天一次）。
 *   - 按间隔：距上次成功满 N 分钟跑一次。
 *   多标签页用 localStorage 短租约互斥；失败后 30 分钟内不重试。
 *
 * AI 实时刷新（2026-10-23 旁路 v1.1.0 新增）：
 *   能力 lingxing.products.refresh 已在 bridge.config.json 登记，本客户端持有
 *   job:execute:lingxing.products.refresh。插件启动即长轮询 /v2/jobs/claim，
 *   领取后调用与手动采集完全相同的 executeOnce，落盘成功才 complete succeeded。
 *   任务输入不接受 URL / endpoint / 代码，只允许 reason、trigger 两个文本字段。
 *
 * 公共状态中心（1.3.0 起）：
 *   已配对时，每个标签页每 20 秒向本地桥上报一次严格运行状态心跳；
 *   只发送 instance_id / state / version / message，不发送账号、URL 或请求参数。
 *   页面上的公共状态中心按 client 聚合，因此多个标签页只算一个业务功能。
 */

(function attachLocalAutomationBridge(globalScope) {
  'use strict';

  const PROTOCOL_VERSION = 2;
  const RESOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const JSON_CONTENT_TYPE_PATTERN = /^(?:application\/json|[^;\s]+\/[^;\s]+\+json)(?:\s*;|$)/i;

  class LocalBridgeError extends Error {
    constructor(message, options = {}) {
      super(message);
      this.name = 'LocalBridgeError';
      this.code = options.code || 'BRIDGE_CLIENT_ERROR';
      this.status = Number.isInteger(options.status) ? options.status : null;
      this.details = options.details ?? null;
      this.requiresPairing = options.requiresPairing === true;
      if (options.cause !== undefined) this.cause = options.cause;
    }
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertResourceId(value, label) {
    if (!RESOURCE_ID_PATTERN.test(value || '')) {
      throw new LocalBridgeError(`${label} 不是有效的资源 ID`, { code: 'INVALID_RESOURCE_ID' });
    }
    const firstSegment = value.split('.')[0].toUpperCase();
    if (
      value.endsWith('.')
      || value === '__proto__'
      || value === 'prototype'
      || value === 'constructor'
      || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(firstSegment)
    ) {
      throw new LocalBridgeError(`${label} 使用了保留名称`, { code: 'INVALID_RESOURCE_ID' });
    }
    return value;
  }

  function normalizeBaseUrl(value) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new LocalBridgeError('baseUrl 必须是本机桥地址', { code: 'INVALID_BASE_URL' });
    }
    let parsed;
    try {
      parsed = new URL(value);
    } catch (cause) {
      throw new LocalBridgeError('baseUrl 不是有效 URL', { code: 'INVALID_BASE_URL', cause });
    }
    if (
      parsed.protocol !== 'http:'
      || !LOOPBACK_HOSTS.has(parsed.hostname)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || (parsed.pathname !== '/' && parsed.pathname !== '')
    ) {
      throw new LocalBridgeError('baseUrl 只能是无路径、无凭据的本机 HTTP 回环地址', {
        code: 'INVALID_BASE_URL',
      });
    }
    return parsed.origin;
  }

  function assertTokenKey(value) {
    if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 256) {
      throw new LocalBridgeError('tokenKey 必须是 1 到 256 字符的非空字符串', {
        code: 'INVALID_TOKEN_KEY',
      });
    }
    return value;
  }

  function assertFilename(value) {
    if (
      typeof value !== 'string'
      || value.trim() !== value
      || value.length < 1
      || value.length > 240
      || value === '.'
      || value === '..'
      || /[\\/:*?"<>|\0-\x1f\x7f]/.test(value)
      || /[. ]$/.test(value)
      || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)
    ) {
      throw new LocalBridgeError('filename 必须是单个安全文件名，不能包含路径或控制字符', {
        code: 'INVALID_FILENAME',
      });
    }
    return value;
  }

  function assertContentType(value) {
    if (
      typeof value !== 'string'
      || value.length < 3
      || value.length > 200
      || !value.includes('/')
      || /[\r\n]/.test(value)
    ) {
      throw new LocalBridgeError('contentType 不是有效的媒体类型', { code: 'INVALID_CONTENT_TYPE' });
    }
    return value;
  }

  function assertArrayBuffer(value) {
    if (Object.prototype.toString.call(value) !== '[object ArrayBuffer]') {
      throw new LocalBridgeError('arrayBuffer 必须是 ArrayBuffer', { code: 'INVALID_BINARY_BODY' });
    }
    return value;
  }

  function assertEtag(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || value.length > 512 || /[\r\n]/.test(value)) {
      throw new LocalBridgeError('etag 不是有效的 HTTP ETag', { code: 'INVALID_ETAG' });
    }
    return value;
  }

  function assertClaimToken(value) {
    if (typeof value !== 'string' || value.length < 24 || value.length > 4096) {
      throw new LocalBridgeError('claimToken 格式无效', { code: 'INVALID_CLAIM_TOKEN' });
    }
    return value;
  }

  function assertWorkerId(value) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:@-]{7,159}$/i.test(value)) {
      throw new LocalBridgeError('workerId 必须是 8 到 160 位安全字符串', {
        code: 'INVALID_WORKER_ID',
      });
    }
    return value;
  }

  function assertRuntimeState(value) {
    if (!['idle', 'running', 'error'].includes(value)) {
      throw new LocalBridgeError('runtime state 必须是 idle、running 或 error', {
        code: 'INVALID_RUNTIME_HEARTBEAT',
      });
    }
    return value;
  }

  function normalizeRuntimeHeartbeat(value) {
    if (!isPlainObject(value)) {
      throw new LocalBridgeError('runtime heartbeat 必须是对象', {
        code: 'INVALID_RUNTIME_HEARTBEAT',
      });
    }
    const allowedFields = new Set(['instance_id', 'state', 'version', 'message']);
    const unknownField = Object.keys(value).find((key) => !allowedFields.has(key));
    if (unknownField) {
      throw new LocalBridgeError(`runtime heartbeat 包含不支持的字段：${unknownField}`, {
        code: 'INVALID_RUNTIME_HEARTBEAT',
      });
    }
    const body = {
      instance_id: assertWorkerId(value.instance_id),
      state: assertRuntimeState(value.state ?? 'idle'),
    };
    if (value.version !== undefined && value.version !== null && value.version !== '') {
      if (typeof value.version !== 'string' || !/^[a-z0-9][a-z0-9._+-]{0,63}$/i.test(value.version)) {
        throw new LocalBridgeError('runtime version 必须是 1 到 64 位安全版本字符串', {
          code: 'INVALID_RUNTIME_HEARTBEAT',
        });
      }
      body.version = value.version;
    }
    if (value.message !== undefined && value.message !== null && value.message !== '') {
      if (
        typeof value.message !== 'string'
        || value.message.length > 500
        || /[\x00-\x1f\x7f]/.test(value.message)
      ) {
        throw new LocalBridgeError('runtime message 必须是不超过 500 字符的字符串', {
          code: 'INVALID_RUNTIME_HEARTBEAT',
        });
      }
      body.message = value.message;
    }
    return body;
  }

  function assertJobObject(value, label) {
    if (!isPlainObject(value) || typeof value.job_id !== 'string' || typeof value.state !== 'string') {
      throw new LocalBridgeError(`${label} 缺少有效 job 对象`, {
        code: 'INVALID_JOB_RESPONSE',
      });
    }
    return value;
  }

  function parseResponseHeaders(rawHeaders) {
    const headers = Object.create(null);
    if (typeof rawHeaders !== 'string') return headers;
    for (const line of rawHeaders.split(/\r?\n/)) {
      const separator = line.indexOf(':');
      if (separator <= 0) continue;
      const name = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (!name) continue;
      headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
    }
    return headers;
  }

  function parseJsonResponse(response, label) {
    const headers = parseResponseHeaders(response.responseHeaders);
    const contentType = headers['content-type'] || '';
    if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
      throw new LocalBridgeError(`${label} 返回的 Content-Type 不是 JSON`, {
        code: 'INVALID_RESPONSE_CONTENT_TYPE',
        status: response.status,
      });
    }
    if (typeof response.responseText !== 'string' || response.responseText.trim() === '') {
      throw new LocalBridgeError(`${label} 返回了空的 JSON 响应`, {
        code: 'EMPTY_JSON_RESPONSE',
        status: response.status,
      });
    }
    let payload;
    try {
      payload = JSON.parse(response.responseText);
    } catch (cause) {
      throw new LocalBridgeError(`${label} 返回了无效 JSON`, {
        code: 'INVALID_JSON_RESPONSE',
        status: response.status,
        cause,
      });
    }
    if (!isPlainObject(payload)) {
      throw new LocalBridgeError(`${label} 的 JSON 顶层必须是对象`, {
        code: 'INVALID_JSON_ENVELOPE',
        status: response.status,
      });
    }
    return { headers, payload };
  }

  function assertSuccessEnvelope(payload, label) {
    if (payload.ok !== true || payload.protocol_version !== PROTOCOL_VERSION) {
      throw new LocalBridgeError(`${label} 返回了不兼容的 v2 响应`, {
        code: 'INVALID_SUCCESS_ENVELOPE',
        details: { protocolVersion: payload.protocol_version ?? null },
      });
    }
  }

  function jsonStringify(value, label) {
    let json;
    try {
      json = JSON.stringify(value);
    } catch (cause) {
      throw new LocalBridgeError(`${label} 无法序列化为 JSON`, {
        code: 'UNSERIALIZABLE_JSON',
        cause,
      });
    }
    if (typeof json !== 'string') {
      throw new LocalBridgeError(`${label} 无法序列化为 JSON 对象`, {
        code: 'UNSERIALIZABLE_JSON',
      });
    }
    return json;
  }

  function requestWithGm(details) {
    return new Promise((resolve, reject) => {
      try {
        GM_xmlhttpRequest({
          ...details,
          anonymous: true,
          timeout: 120000,
          onload: resolve,
          onabort: () => reject(new LocalBridgeError('本地桥请求已取消', { code: 'REQUEST_ABORTED' })),
          ontimeout: () => reject(new LocalBridgeError('本地桥请求超时', { code: 'REQUEST_TIMEOUT' })),
          onerror: () => reject(new LocalBridgeError('无法连接本地桥', { code: 'NETWORK_ERROR' })),
        });
      } catch (cause) {
        reject(new LocalBridgeError('GM_xmlhttpRequest 调用失败', {
          code: 'REQUEST_SETUP_FAILED',
          cause,
        }));
      }
    });
  }

  function createLocalBridgeClient(options) {
    if (!isPlainObject(options)) {
      throw new LocalBridgeError('客户端配置必须是对象', { code: 'INVALID_CLIENT_OPTIONS' });
    }
    if (
      typeof GM_xmlhttpRequest !== 'function'
      || typeof GM_getValue !== 'function'
      || typeof GM_setValue !== 'function'
    ) {
      throw new LocalBridgeError(
        '缺少 GM_xmlhttpRequest、GM_getValue 或 GM_setValue；请检查油猴 @grant',
        { code: 'MISSING_GM_API' },
      );
    }

    const clientId = assertResourceId(options.clientId, 'clientId');
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const tokenKey = assertTokenKey(options.tokenKey);

    async function readToken() {
      const token = await Promise.resolve(GM_getValue(tokenKey, ''));
      if (typeof token !== 'string' || token.length < 1 || token.length > 4096) {
        throw new LocalBridgeError('本客户端尚未配对，请先显式调用 pair(code)', {
          code: 'PAIRING_REQUIRED',
          requiresPairing: true,
        });
      }
      return token;
    }

    async function request({
      method,
      path,
      headers = {},
      data,
      authenticated = true,
      expectedStatuses,
      label,
      allowEmpty = false,
    }) {
      const requestHeaders = {
        Accept: 'application/json',
        'X-Local-Bridge-Client': clientId,
        ...headers,
      };
      if (authenticated) requestHeaders.Authorization = `Bearer ${await readToken()}`;

      const response = await requestWithGm({
        method,
        url: `${baseUrl}${path}`,
        headers: requestHeaders,
        data,
      });
      const status = Number(response.status);
      if (!Number.isInteger(status)) {
        throw new LocalBridgeError(`${label} 缺少有效 HTTP 状态码`, {
          code: 'INVALID_HTTP_STATUS',
        });
      }

      if (allowEmpty && expectedStatuses.includes(status) && status === 304) {
        return {
          status,
          headers: parseResponseHeaders(response.responseHeaders),
          payload: null,
        };
      }

      const parsed = parseJsonResponse(response, label);
      if (!expectedStatuses.includes(status)) {
        const error = isPlainObject(parsed.payload.error) ? parsed.payload.error : null;
        const errorCode = typeof error?.code === 'string' ? error.code : 'UNEXPECTED_HTTP_STATUS';
        const errorMessage = typeof error?.message === 'string'
          ? error.message
          : `${label} 返回了未预期的 HTTP ${status}`;
        throw new LocalBridgeError(errorMessage, {
          code: errorCode,
          status,
          details: {
            requestId: typeof error?.request_id === 'string' ? error.request_id : null,
          },
          requiresPairing: status === 401,
        });
      }
      return { status, ...parsed };
    }

    async function pair(code) {
      if (typeof code !== 'string' || code.length < 24 || code.length > 256) {
        throw new LocalBridgeError('配对码格式无效', { code: 'INVALID_PAIRING_CODE' });
      }
      const result = await request({
        method: 'POST',
        path: '/v2/pair',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify({ client_id: clientId, pairing_code: code }, '配对请求'),
        authenticated: false,
        expectedStatuses: [200],
        label: '配对接口',
      });
      assertSuccessEnvelope(result.payload, '配对接口');
      if (result.payload.client_id !== clientId) {
        throw new LocalBridgeError('配对响应的 client_id 与请求不一致', {
          code: 'CLIENT_ID_MISMATCH',
          status: result.status,
        });
      }
      const token = result.payload.token;
      if (typeof token !== 'string' || token.length < 24 || token.length > 4096) {
        throw new LocalBridgeError('配对响应缺少有效令牌', {
          code: 'INVALID_PAIRING_RESPONSE',
          status: result.status,
        });
      }
      await Promise.resolve(GM_setValue(tokenKey, token));
      return {
        ok: true,
        clientId,
        issuedAt: typeof result.payload.issued_at === 'string' ? result.payload.issued_at : null,
        permissions: Array.isArray(result.payload.permissions)
          ? result.payload.permissions.filter((item) => typeof item === 'string')
          : [],
      };
    }

    async function capabilities() {
      const result = await request({
        method: 'GET',
        path: '/v2/capabilities',
        expectedStatuses: [200],
        label: '能力清单接口',
      });
      assertSuccessEnvelope(result.payload, '能力清单接口');
      if (!isPlainObject(result.payload.client) || result.payload.client.id !== clientId) {
        throw new LocalBridgeError('能力清单的客户端身份不匹配', {
          code: 'CLIENT_ID_MISMATCH',
          status: result.status,
        });
      }
      if (!Array.isArray(result.payload.permissions) || !isPlainObject(result.payload.resources)) {
        throw new LocalBridgeError('能力清单结构无效', {
          code: 'INVALID_CAPABILITIES_RESPONSE',
          status: result.status,
        });
      }
      return result.payload;
    }

    async function health() {
      const result = await request({
        method: 'GET',
        path: '/health',
        authenticated: false,
        expectedStatuses: [200],
        label: '健康检查接口',
      });
      if (result.payload.ok !== true || result.payload.service_id !== 'local-automation-bridge') {
        throw new LocalBridgeError('健康检查返回了不兼容的响应', {
          code: 'INVALID_HEALTH_RESPONSE',
          status: result.status,
        });
      }
      return result.payload;
    }

    async function runtimeHeartbeat(body) {
      const normalized = normalizeRuntimeHeartbeat(body);
      const result = await request({
        method: 'POST',
        path: '/v2/runtime/heartbeat',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify(normalized, 'runtime heartbeat 请求'),
        expectedStatuses: [200],
        label: '运行状态心跳接口',
      });
      assertSuccessEnvelope(result.payload, '运行状态心跳接口');
      if (!isPlainObject(result.payload.runtime)) {
        throw new LocalBridgeError('运行状态心跳响应缺少 runtime 对象', {
          code: 'INVALID_RUNTIME_RESPONSE',
          status: result.status,
        });
      }
      return result.payload.runtime;
    }

    async function heartbeat(instanceId, options = {}) {
      if (!isPlainObject(options)) {
        throw new LocalBridgeError('heartbeat options 必须是对象', {
          code: 'INVALID_RUNTIME_HEARTBEAT',
        });
      }
      return runtimeHeartbeat({ ...options, instance_id: instanceId });
    }

    async function runtimeStatus() {
      const result = await request({
        method: 'GET',
        path: '/v2/runtime/status',
        expectedStatuses: [200],
        label: '运行状态接口',
      });
      assertSuccessEnvelope(result.payload, '运行状态接口');
      const runtime = result.payload.runtime;
      if (
        !isPlainObject(runtime)
        || !isPlainObject(runtime.summary)
        || !Array.isArray(runtime.logical_clients)
        || !Array.isArray(runtime.instances)
      ) {
        throw new LocalBridgeError('运行状态响应结构无效', {
          code: 'INVALID_RUNTIME_RESPONSE',
          status: result.status,
        });
      }
      return result.payload;
    }

    async function getConfig(id, etag) {
      const resourceId = assertResourceId(id, 'config id');
      const previousEtag = assertEtag(etag);
      const result = await request({
        method: 'GET',
        path: `/v2/configs/${encodeURIComponent(resourceId)}`,
        headers: previousEtag ? { 'If-None-Match': previousEtag } : {},
        expectedStatuses: [200, 304],
        label: '配置读取接口',
        allowEmpty: true,
      });
      const responseEtag = result.headers.etag || previousEtag || null;
      if (result.status === 304) {
        return { notModified: true, etag: responseEtag, config: null };
      }
      assertSuccessEnvelope(result.payload, '配置读取接口');
      if (!isPlainObject(result.payload.config)) {
        throw new LocalBridgeError('配置读取响应缺少 config 对象', {
          code: 'INVALID_CONFIG_RESPONSE',
          status: result.status,
        });
      }
      return {
        notModified: false,
        etag: responseEtag,
        config: result.payload.config,
        requestId: typeof result.payload.request_id === 'string' ? result.payload.request_id : null,
      };
    }

    async function ingestDataset(id, body) {
      const resourceId = assertResourceId(id, 'dataset id');
      if (!isPlainObject(body)) {
        throw new LocalBridgeError('数据集请求体必须是普通对象', { code: 'INVALID_DATASET_BODY' });
      }
      const datasetInBody = body.dataset ?? body.dataset_id;
      if (datasetInBody !== undefined && datasetInBody !== resourceId) {
        throw new LocalBridgeError('请求体中的 dataset 与接口资源 ID 不一致', {
          code: 'DATASET_ID_MISMATCH',
        });
      }
      const payload = datasetInBody === undefined ? { ...body, dataset: resourceId } : { ...body };
      const result = await request({
        method: 'POST',
        path: `/v2/datasets/${encodeURIComponent(resourceId)}/ingest`,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify(payload, '数据集请求体'),
        expectedStatuses: [200, 201],
        label: '数据集写入接口',
      });
      assertSuccessEnvelope(result.payload, '数据集写入接口');
      if (result.payload.committed !== true || result.payload.dataset_id !== resourceId) {
        throw new LocalBridgeError('数据集写入确认与请求不一致', {
          code: 'INVALID_INGEST_ACK',
          status: result.status,
        });
      }
      return result.payload;
    }

    async function uploadArtifact(bucket, filename, arrayBuffer, contentType) {
      const bucketId = assertResourceId(bucket, 'artifact bucket');
      const safeFilename = assertFilename(filename);
      const binary = assertArrayBuffer(arrayBuffer);
      const mediaType = assertContentType(contentType);
      const result = await request({
        method: 'POST',
        path: `/v2/artifacts/${encodeURIComponent(bucketId)}?filename=${encodeURIComponent(safeFilename)}`,
        headers: { 'Content-Type': mediaType },
        data: binary,
        expectedStatuses: [200, 201],
        label: '文件上传接口',
      });
      assertSuccessEnvelope(result.payload, '文件上传接口');
      if (!isPlainObject(result.payload.artifact)) {
        throw new LocalBridgeError('文件上传响应缺少 artifact 对象', {
          code: 'INVALID_ARTIFACT_RESPONSE',
          status: result.status,
        });
      }
      return result.payload;
    }

    async function jobCapabilities() {
      const result = await request({
        method: 'GET',
        path: '/v2/job-capabilities',
        expectedStatuses: [200],
        label: '任务能力清单接口',
      });
      assertSuccessEnvelope(result.payload, '任务能力清单接口');
      if (!Array.isArray(result.payload.job_capabilities)) {
        throw new LocalBridgeError('任务能力清单结构无效', {
          code: 'INVALID_JOB_CAPABILITIES_RESPONSE',
          status: result.status,
        });
      }
      return result.payload.job_capabilities;
    }

    async function createJob(capability, input = {}, options = {}) {
      const capabilityId = assertResourceId(capability, 'capability');
      if (!isPlainObject(input) || !isPlainObject(options)) {
        throw new LocalBridgeError('任务 input 和 options 必须是普通对象', {
          code: 'INVALID_JOB_REQUEST',
        });
      }
      const body = { capability: capabilityId, input };
      if (options.idempotencyKey !== undefined) body.idempotency_key = String(options.idempotencyKey);
      if (options.ttlSeconds !== undefined) body.ttl_seconds = Number(options.ttlSeconds);
      if (options.confirmed === true) body.confirmed = true;
      const result = await request({
        method: 'POST',
        path: '/v2/jobs',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify(body, '任务创建请求'),
        expectedStatuses: [200, 201],
        label: '任务创建接口',
      });
      assertSuccessEnvelope(result.payload, '任务创建接口');
      return {
        duplicate: result.payload.duplicate === true,
        job: assertJobObject(result.payload.job, '任务创建接口'),
      };
    }

    async function claimJobs(capabilityIds, workerId, waitMs = 25000) {
      if (
        !Array.isArray(capabilityIds)
        || capabilityIds.length === 0
        || capabilityIds.some((value) => typeof value !== 'string')
      ) {
        throw new LocalBridgeError('capabilityIds 必须是非空字符串数组', {
          code: 'INVALID_JOB_CLAIM',
        });
      }
      const capabilitiesForClaim = [...new Set(
        capabilityIds.map((value) => assertResourceId(value, 'capability')),
      )];
      const normalizedWaitMs = Number(waitMs);
      if (!Number.isSafeInteger(normalizedWaitMs) || normalizedWaitMs < 0 || normalizedWaitMs > 25000) {
        throw new LocalBridgeError('waitMs 必须是 0 到 25000 之间的整数', {
          code: 'INVALID_JOB_CLAIM',
        });
      }
      const result = await request({
        method: 'POST',
        path: '/v2/jobs/claim',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify({
          capabilities: capabilitiesForClaim,
          worker_id: assertWorkerId(workerId),
          wait_ms: normalizedWaitMs,
        }, '任务领取请求'),
        expectedStatuses: [200],
        label: '任务领取接口',
      });
      assertSuccessEnvelope(result.payload, '任务领取接口');
      if (result.payload.job === null && result.payload.claim_token === null) return null;
      const job = assertJobObject(result.payload.job, '任务领取接口');
      return { job, claimToken: assertClaimToken(result.payload.claim_token) };
    }

    async function getJob(jobId) {
      const normalizedJobId = assertResourceId(jobId, 'jobId');
      const result = await request({
        method: 'GET',
        path: `/v2/jobs/${encodeURIComponent(normalizedJobId)}`,
        expectedStatuses: [200],
        label: '任务状态接口',
      });
      assertSuccessEnvelope(result.payload, '任务状态接口');
      return assertJobObject(result.payload.job, '任务状态接口');
    }

    async function reportJobProgress(jobId, claimToken, progress) {
      const normalizedJobId = assertResourceId(jobId, 'jobId');
      const result = await request({
        method: 'POST',
        path: `/v2/jobs/${encodeURIComponent(normalizedJobId)}/progress`,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify({
          claim_token: assertClaimToken(claimToken),
          progress: progress ?? null,
        }, '任务进度请求'),
        expectedStatuses: [200],
        label: '任务进度接口',
      });
      assertSuccessEnvelope(result.payload, '任务进度接口');
      return assertJobObject(result.payload.job, '任务进度接口');
    }

    async function completeJob(jobId, claimToken, state, details = {}) {
      const normalizedJobId = assertResourceId(jobId, 'jobId');
      if (!['succeeded', 'failed'].includes(state) || !isPlainObject(details)) {
        throw new LocalBridgeError('任务完成状态或 details 无效', {
          code: 'INVALID_JOB_COMPLETION',
        });
      }
      const body = {
        claim_token: assertClaimToken(claimToken),
        state,
      };
      if (state === 'succeeded') body.result = details.result ?? null;
      else body.error = details.error ?? { code: 'EXECUTION_FAILED', message: '浏览器任务执行失败' };
      if (details.progress !== undefined) body.progress = details.progress;
      const result = await request({
        method: 'POST',
        path: `/v2/jobs/${encodeURIComponent(normalizedJobId)}/complete`,
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        data: jsonStringify(body, '任务完成请求'),
        expectedStatuses: [200],
        label: '任务完成接口',
      });
      assertSuccessEnvelope(result.payload, '任务完成接口');
      return {
        duplicate: result.payload.duplicate === true,
        job: assertJobObject(result.payload.job, '任务完成接口'),
      };
    }

    return Object.freeze({
      pair,
      health,
      capabilities,
      runtimeHeartbeat,
      heartbeat,
      runtimeStatus,
      getConfig,
      ingestDataset,
      uploadArtifact,
      jobCapabilities,
      createJob,
      claimJobs,
      getJob,
      reportJobProgress,
      completeJob,
    });
  }

  const exported = Object.freeze({
    createLocalBridgeClient,
    LocalBridgeError,
  });

  if (typeof module === 'object' && module && module.exports) {
    module.exports = exported;
  } else {
    Object.defineProperty(globalScope, 'LocalAutomationBridge', {
      configurable: false,
      enumerable: true,
      writable: false,
      value: exported,
    });
  }
}(typeof globalThis === 'object' ? globalThis : this));

(function universalModuleDefinition(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LingXingPageClient = api;
  }
}(typeof globalThis === 'object' ? globalThis : this, function createModule() {
  'use strict';

  const VERSION = '1.0.0';
  const TRANSPORTS = Object.freeze(['post', 'gwPost', 'gateGet', 'gatePost']);
  const DEFAULT_SELECTORS = Object.freeze([
    '#app',
    '.app-wrapper',
    '.el-main',
    '.fba-shipment',
  ]);

  class LingXingPageClientError extends Error {
    constructor(code, message, details, cause) {
      super(message);
      this.name = 'LingXingPageClientError';
      this.code = code;
      this.details = details || {};
      if (cause !== undefined) this.cause = cause;
    }

    toJSON() {
      return {
        name: this.name,
        code: this.code,
        message: this.message,
        details: this.details,
      };
    }
  }

  function error(code, message, details, cause) {
    return new LingXingPageClientError(code, message, details, cause);
  }

  function safeRead(target, key, diagnostics) {
    if (target == null) return undefined;
    try {
      return target[key];
    } catch (_) {
      if (diagnostics) diagnostics.readErrors += 1;
      return undefined;
    }
  }

  function safePush(queue, value) {
    if (value == null) return;
    if ((typeof value === 'object' || typeof value === 'function')) queue.push(value);
  }

  function normalizeBusinessResponse(response) {
    if (response && typeof response === 'object') {
      if (response.code !== undefined) return response;
      if (response.data && typeof response.data === 'object' && response.data.code !== undefined) {
        return response.data;
      }
    }
    return response;
  }

  function getPageWindow(explicitWindow) {
    if (explicitWindow && typeof explicitWindow === 'object') return explicitWindow;
    if (typeof unsafeWindow === 'object' && unsafeWindow) return unsafeWindow;
    if (typeof window === 'object' && window) return window;
    return null;
  }

  function getPageDocument(pageWindow, explicitDocument) {
    if (explicitDocument && typeof explicitDocument.querySelector === 'function') {
      return explicitDocument;
    }
    try {
      if (pageWindow && pageWindow.document) return pageWindow.document;
    } catch (_) {
      // A structured context error is returned by discoverTransports.
    }
    return null;
  }

  function normalizeRequiredTransports(input) {
    if (input == null) return [];
    if (!Array.isArray(input)) {
      throw error(
        'LINGXING_INVALID_ARGUMENT',
        'requiredTransports 必须是数组。',
        { argument: 'requiredTransports' },
      );
    }
    const unique = [];
    for (const value of input) {
      if (!TRANSPORTS.includes(value)) {
        throw error(
          'LINGXING_INVALID_ARGUMENT',
          `不支持的领星请求传输层：${String(value)}`,
          { argument: 'requiredTransports', supported: [...TRANSPORTS] },
        );
      }
      if (!unique.includes(value)) unique.push(value);
    }
    return unique;
  }

  function collectVueRoots(pageDocument, selectors, extraRoots, diagnostics) {
    const roots = [];
    const seen = new Set();

    function add(value) {
      if (value == null || seen.has(value)) return;
      if (typeof value !== 'object' && typeof value !== 'function') return;
      seen.add(value);
      roots.push(value);
    }

    if (Array.isArray(extraRoots)) extraRoots.forEach(add);
    if (!pageDocument) return roots;

    for (const selector of selectors) {
      let elements = [];
      try {
        if (typeof pageDocument.querySelectorAll === 'function') {
          elements = Array.from(pageDocument.querySelectorAll(selector));
        } else if (typeof pageDocument.querySelector === 'function') {
          const element = pageDocument.querySelector(selector);
          if (element) elements = [element];
        }
      } catch (_) {
        diagnostics.selectorErrors += 1;
      }

      for (const element of elements) {
        add(safeRead(element, '__vue__', diagnostics));
        const component = safeRead(element, '__vueParentComponent', diagnostics);
        add(safeRead(component, 'proxy', diagnostics));
        add(safeRead(component, 'ctx', diagnostics));
      }
    }

    return roots;
  }

  function inspectCandidate(candidate, bindings, diagnostics) {
    if (!bindings.post) {
      const method = safeRead(candidate, '$post', diagnostics);
      if (typeof method === 'function') bindings.post = { owner: candidate, method };
    }

    if (!bindings.gwPost) {
      const method = safeRead(candidate, '$gwPost', diagnostics);
      if (typeof method === 'function') bindings.gwPost = { owner: candidate, method };
    }

    const gateAxios = safeRead(candidate, '$gateAxios', diagnostics);
    if (gateAxios && (typeof gateAxios === 'object' || typeof gateAxios === 'function')) {
      if (!bindings.gateGet) {
        const method = safeRead(gateAxios, 'get', diagnostics);
        if (typeof method === 'function') bindings.gateGet = { owner: gateAxios, method };
      }
      if (!bindings.gatePost) {
        const method = safeRead(gateAxios, 'post', diagnostics);
        if (typeof method === 'function') bindings.gatePost = { owner: gateAxios, method };
      }
    }
  }

  function pageIdentity(pageWindow) {
    try {
      const location = pageWindow && pageWindow.location;
      return {
        origin: location && typeof location.origin === 'string' ? location.origin : '',
        pathname: location && typeof location.pathname === 'string' ? location.pathname : '',
      };
    } catch (_) {
      return { origin: '', pathname: '' };
    }
  }

  function discoverTransports(options) {
    const opts = options || {};
    const pageWindow = getPageWindow(opts.pageWindow);
    const pageDocument = getPageDocument(pageWindow, opts.pageDocument);
    const selectors = Array.isArray(opts.selectors) && opts.selectors.length > 0
      ? opts.selectors.map(String)
      : [...DEFAULT_SELECTORS];
    const maxNodes = Number.isInteger(opts.maxNodes) && opts.maxNodes > 0
      ? opts.maxNodes
      : 5000;
    const scan = {
      scannedAt: new Date().toISOString(),
      rootCount: 0,
      visitedCount: 0,
      truncated: false,
      readErrors: 0,
      selectorErrors: 0,
    };

    if (!pageDocument && !(Array.isArray(opts.roots) && opts.roots.length > 0)) {
      throw error(
        'LINGXING_PAGE_CONTEXT_UNAVAILABLE',
        '无法访问领星页面上下文。请在领星 ERP 页面内运行，并传入 unsafeWindow。',
        { hasPageWindow: Boolean(pageWindow), rawFetchFallback: false },
      );
    }

    const roots = collectVueRoots(pageDocument, selectors, opts.roots, scan);
    scan.rootCount = roots.length;
    const queue = roots.slice();
    const seen = new Set();
    const bindings = Object.create(null);

    while (queue.length > 0 && seen.size < maxNodes) {
      const candidate = queue.shift();
      if (candidate == null || seen.has(candidate)) continue;
      if (typeof candidate !== 'object' && typeof candidate !== 'function') continue;
      seen.add(candidate);
      inspectCandidate(candidate, bindings, scan);

      const children = safeRead(candidate, '$children', scan);
      if (Array.isArray(children)) children.forEach((child) => safePush(queue, child));
      safePush(queue, safeRead(candidate, '$parent', scan));
      safePush(queue, safeRead(candidate, '$root', scan));

      // Vue 3 component internals. These are discovery hints only; credentials and
      // browser storage are intentionally never inspected.
      const component = safeRead(candidate, '$', scan);
      safePush(queue, safeRead(component, 'parent', scan));
      safePush(queue, safeRead(component, 'root', scan));
      safePush(queue, safeRead(component, 'proxy', scan));
      safePush(queue, safeRead(component, 'ctx', scan));
    }

    scan.visitedCount = seen.size;
    scan.truncated = queue.length > 0;
    const availableTransports = TRANSPORTS.filter((name) => Boolean(bindings[name]));
    return {
      pageWindow,
      pageDocument,
      selectors,
      maxNodes,
      bindings,
      diagnostics: {
        sdkVersion: VERSION,
        page: pageIdentity(pageWindow),
        availableTransports,
        scan,
        security: {
          usesPageRequestClientsOnly: true,
          rawFetchFallback: false,
          readsCredentials: false,
        },
      },
    };
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function validatePath(path) {
    if (
      typeof path !== 'string'
      || path.trim() !== path
      || path.length < 2
      || !path.startsWith('/')
      || path.startsWith('//')
      || /[\\\u0000-\u001f\u007f]/.test(path)
      || /^[a-z][a-z0-9+.-]*:/i.test(path)
    ) {
      throw error(
        'LINGXING_INVALID_ARGUMENT',
        '请求 path 必须是以单个 / 开头的领星站内相对路径，不能是绝对 URL、协议相对地址或包含反斜杠/控制字符。',
        { argument: 'path', requiresRelativePath: true },
      );
    }
  }

  class PageClient {
    constructor(options, discovery, requiredTransports, waitDiagnostics) {
      this._options = Object.assign({}, options || {});
      this._requiredTransports = requiredTransports.slice();
      this._discovery = discovery;
      this._waitDiagnostics = waitDiagnostics || null;
    }

    capabilities() {
      return {
        transports: this._discovery.diagnostics.availableTransports.slice(),
        rawFetchFallback: false,
      };
    }

    diagnostics() {
      const available = this._discovery.diagnostics.availableTransports.slice();
      return {
        sdkVersion: VERSION,
        page: Object.assign({}, this._discovery.diagnostics.page),
        selectors: this._discovery.selectors.slice(),
        requiredTransports: this._requiredTransports.slice(),
        availableTransports: available,
        missingTransports: this._requiredTransports.filter((name) => !available.includes(name)),
        scan: Object.assign({}, this._discovery.diagnostics.scan),
        wait: this._waitDiagnostics ? Object.assign({}, this._waitDiagnostics) : null,
        security: Object.assign({}, this._discovery.diagnostics.security),
      };
    }

    refresh() {
      this._discovery = discoverTransports(this._options);
      return this.diagnostics();
    }

    _binding(name) {
      let binding = this._discovery.bindings[name];
      if (!binding) {
        this.refresh();
        binding = this._discovery.bindings[name];
      }
      if (!binding) {
        const diagnostics = this.diagnostics();
        throw error(
          'LINGXING_TRANSPORT_UNAVAILABLE',
          `当前领星页面未找到请求传输层 ${name}。请确认页面已加载且探针证据中的调用层与页面一致。`,
          { transport: name, diagnostics },
        );
      }
      return binding;
    }

    async _invoke(name, path, args) {
      validatePath(path);
      const binding = this._binding(name);
      try {
        return await binding.method.call(binding.owner, path, ...args);
      } catch (cause) {
        if (cause instanceof LingXingPageClientError) throw cause;
        throw error(
          'LINGXING_REQUEST_FAILED',
          `领星 ${name} 请求失败：${cause && cause.message ? cause.message : String(cause)}`,
          { transport: name, path },
          cause,
        );
      }
    }

    async post(path, payload, options) {
      const opts = options || {};
      const requestConfig = opts.requestConfig || {};
      const arg4 = opts.arg4 === undefined ? null : opts.arg4;
      const arg5 = opts.arg5 === undefined ? null : opts.arg5;
      const sequenceGroup = opts.sequenceGroup === undefined ? null : opts.sequenceGroup;
      const response = await this._invoke(
        'post',
        path,
        [payload, requestConfig, arg4, arg5, sequenceGroup],
      );
      return opts.normalizeBusiness === false ? response : normalizeBusinessResponse(response);
    }

    async gwPost(path, payload, options) {
      const opts = options || {};
      const response = await this._invoke('gwPost', path, [payload]);
      return opts.normalizeBusiness === false ? response : normalizeBusinessResponse(response);
    }

    async gateGet(path, config) {
      return this._invoke('gateGet', path, [config || {}]);
    }

    async gatePost(path, payload, config) {
      return this._invoke('gatePost', path, [payload, config || {}]);
    }
  }

  function find(options) {
    const requiredTransports = normalizeRequiredTransports(
      options && options.requiredTransports,
    );
    const discovery = discoverTransports(options);
    return new PageClient(options, discovery, requiredTransports, {
      elapsedMs: 0,
      attempts: 1,
      timedOut: false,
    });
  }

  async function connect(options) {
    const opts = options || {};
    const requiredTransports = normalizeRequiredTransports(opts.requiredTransports);
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs >= 0
      ? Number(opts.timeoutMs)
      : 15000;
    const pollMs = Number.isFinite(opts.pollMs) && opts.pollMs > 0
      ? Number(opts.pollMs)
      : 250;
    const startedAt = Date.now();
    let attempts = 0;
    let lastDiscovery = null;

    do {
      attempts += 1;
      lastDiscovery = discoverTransports(opts);
      const available = lastDiscovery.diagnostics.availableTransports;
      const missing = requiredTransports.filter((name) => !available.includes(name));
      if (missing.length === 0) {
        return new PageClient(opts, lastDiscovery, requiredTransports, {
          elapsedMs: Date.now() - startedAt,
          attempts,
          timedOut: false,
        });
      }
      if (Date.now() - startedAt >= timeoutMs) break;
      await delay(Math.min(pollMs, Math.max(1, timeoutMs - (Date.now() - startedAt))));
    } while (Date.now() - startedAt <= timeoutMs);

    const available = lastDiscovery
      ? lastDiscovery.diagnostics.availableTransports
      : [];
    const missing = requiredTransports.filter((name) => !available.includes(name));
    throw error(
      'LINGXING_CLIENT_TIMEOUT',
      `等待领星页面请求客户端超时；缺少：${missing.join('、') || '未知传输层'}。`,
      {
        timeoutMs,
        attempts,
        requiredTransports,
        availableTransports: available,
        missingTransports: missing,
        diagnostics: lastDiscovery ? lastDiscovery.diagnostics : null,
      },
    );
  }

  return Object.freeze({
    VERSION,
    TRANSPORTS,
    DEFAULT_SELECTORS,
    LingXingPageClientError,
    normalizeBusinessResponse,
    discoverTransports,
    find,
    connect,
  });
}));

(function lingxingProductsCollector() {
  'use strict';

  // ===========================================================================
  // 领星「产品管理 → 产品列表」采集
  // 证据来源：2026-10-21 15:42 接口探针样本
  //   logical 层：transport=post, path=/api/product/lists, sequence_group="request"
  //   响应为扁平结构 { code, msg, total, list }（不是 data.list）
  // ===========================================================================

  const ACCOUNT_KEY_STORE = 'lx_products_account_key_v1';
  const AUTO_STORE = 'lx_products_auto_v1';
  const LAST_OK_STORE = 'lx_products_last_ok_v1';
  const LAST_RESULT_STORE = 'lx_products_last_result_v1';
  const PAGE_SIZE = 200;
  const MAX_PAGES = 100;
  const STATUS_ID = 'lx-products-status-bar';

  // ---- AI 实时刷新（本地桥 job 队列）----------------------------------------
  // 能力 ID 必须在桥注册表 job_capabilities 中登记，并在本客户端权限里授予
  // job:execute:lingxing.products.refresh。插件只执行这一个固定能力，
  // 不执行任务输入里的任何 URL / endpoint / 代码。
  const JOB_CAPABILITY = 'lingxing.products.refresh';
  const JOB_WORKER_KEY = 'lx_products_job_worker_id_v1';
  const JOB_LEADER_KEY = 'lx_products_job_leader_v1';
  const JOB_CLAIM_WAIT_MS = 25000;
  const JOB_IDLE_RETRY_MS = 3000;
  const JOB_ERROR_RETRY_MAX_MS = 60000;
  const JOB_REQUEST_TIMEOUT_MS = 35000;
  const JOB_MIN_RUN_BUDGET_MS = 20000;
  const JOB_COMPLETION_RESERVE_MS = 15000;
  const JOB_LEADER_TTL_MS = 60000;
  const JOB_LEADER_HEARTBEAT_MS = 15000;
  const PLUGIN_VERSION = '1.3.0';
  const RUNTIME_HEARTBEAT_MS = 20000;

  const runtime = {
    jobWorkerStarted: false,
    jobWorkerStopped: false,
    jobWorkerLeader: false,
    jobWorkerLeaderHeartbeat: null,
    jobWorkerTabId: `tab-${Math.random().toString(36).slice(2, 10)}`,
    jobWorkerId: '',
    activeBridgeJobId: '',
    nextAutoAttemptAt: 0,
    lastPanelStatus: null,
    runtimeHeartbeatState: 'idle',
    runtimeHeartbeatMessage: '已加载，等待任务',
    runtimeHeartbeatTimer: null,
    runtimeHeartbeatInFlight: false,
    runtimeHeartbeatPending: false,
    runtimeHeartbeatLastWarningAt: 0,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let running = false;

  const FEATURE = Object.freeze({
    setupComplete: true,
    id: 'products',
    title: '领星产品库采集',
    page: {
      // 领星的 $post 挂在 Vue 根实例上，任何领星页面都能取到，不需要停在产品列表页。
      // 这里只校验"在领星站点内"，避免在别的站点误触发。
      test(url) {
        return url.origin === 'https://erp.lingxing.com';
      },
    },
    request: {
      // 只能用探针观察到的传输层，禁止回退到其它 transport 或裸 fetch
      transport: 'post',
      path: '/api/product/lists',
      sequenceGroup: 'request',
    },
    bridge: {
      clientId: 'userscript.lingxing.products.v1',
      tokenKey: 'lx_products_bridge_token_v1',
      datasetId: 'products',
    },
  });

  // 与页面自身「产品列表」首屏请求完全一致的筛选条件（全部为空 = 全量）
  const BASE_PAYLOAD = Object.freeze({
    custom_fields: null,
    search_field_time: 'create_time',
    product_creator_uid: [],
    product_developer_uid: [],
    permission_uid: [],
    cg_opt_uid: [],
    supplier_id: [],
    sort_field: 'create_time',
    sort_type: 'desc',
    search_field: 'sku',
    search_value: null,
    bid: null,
    cid: null,
    attribute: [],
    status: [],
    open_status: '',
    gtag_ids: '',
    start_date: null,
    end_date: null,
    senior_search_list: '[]',
    single_product_id: [],
    is_matched_listing: '',
    is_matched_alibaba: '',
    relation_aux: '',
    is_have_pic: '',
    cg_package: '',
    cg_product_gross_weight: { left: '', right: '', symbol: 'gt' },
    cg_price: { left: '', right: '', symbol: 'gt' },
    cg_transport_costs: { left: '', right: '', symbol: 'gt', country_code: 'US' },
    is_combo: '',
    is_aux: 0,
    product_type: [1, 2],
    selected_product_ids: '',
  });

  // ------------------------------------------------------------------ 状态提示

  function statusBar(text, kind) {
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = STATUS_ID;
      el.style.cssText = [
        // 放左下角：右下角被功能面板占了，避免互相遮挡
        'position:fixed', 'left:16px', 'bottom:16px', 'z-index:2147483601',
        'max-width:360px', 'padding:10px 14px', 'border-radius:10px',
        'background:#0f172a', 'color:#e6edf7', 'font:13px/1.55 -apple-system,"Microsoft YaHei",sans-serif',
        'box-shadow:0 8px 24px rgba(0,0,0,.28)', 'white-space:pre-wrap',
      ].join(';');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.background = kind === 'error' ? '#7f1d1d' : kind === 'ok' ? '#064e3b' : '#0f172a';
    // 面板打开时同步到面板状态区，用户不用盯着两个地方
    panelSetStatus(text, kind);
  }

  function hideStatus(delay) {
    setTimeout(() => {
      const el = document.getElementById(STATUS_ID);
      if (el) el.remove();
    }, delay || 0);
  }

  // ------------------------------------------------------------------ 账号标识
  // 规范：账号标识必须来自真实页面或响应，不能写所有账号共用的常量。
  // 这里优先从页面 localStorage 的业务字段猜一个默认值，最终由用户确认一次后存起来。

  function detectCompanyHint() {
    try {
      const storage = unsafeWindow.localStorage;
      if (!storage) return '';
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i) || '';
        if (!/compan/i.test(key)) continue;
        const raw = String(storage.getItem(key) || '').trim();
        if (/^\d{1,20}$/.test(raw)) return raw;
      }
    } catch (_) { /* 读不到就算了，交给用户填 */ }
    return '';
  }

  function resolveAccountKey() {
    const saved = String(GM_getValue(ACCOUNT_KEY_STORE, '') || '').trim();
    if (saved) return saved;
    // 不再弹 prompt：面板里有「账号标识」输入框，缺了就让用户在那里填
    const error = new Error('尚未设置账号标识：请在面板「账号标识」里填写并保存');
    error.code = 'ACCOUNT_KEY_MISSING';
    throw error;
  }

  // ------------------------------------------------------------------ 采集

  function recordKey(record) {
    if (record && record.id !== undefined && record.id !== null && record.id !== '') {
      return `id:${record.id}`;
    }
    if (record && record.product_id) return `product_id:${record.product_id}`;
    if (record && record.sku) return `sku:${record.sku}`;
    return null;
  }

  async function fetchPage(client, offset, length) {
    const payload = Object.assign({}, BASE_PAYLOAD, { offset, length });
    const response = await client.post(FEATURE.request.path, payload, {
      sequenceGroup: FEATURE.request.sequenceGroup,
    });
    // 证据：响应是扁平结构，total / list 都在顶层
    if (!response || response.code !== 1 || !Array.isArray(response.list)) {
      throw new Error((response && response.msg) || `offset=${offset} 返回结构异常`);
    }
    const total = Number(response.total);
    if (!Number.isFinite(total) || total < 0) {
      throw new Error(`offset=${offset} 缺少有效的 total`);
    }
    return { rows: response.list, total };
  }

  async function collectAll(client, report) {
    const notify = typeof report === 'function' ? report : (msg) => statusBar(msg);
    let pageSize = PAGE_SIZE;
    let offset = 0;
    let pages = 0;
    let expectedTotal = null;
    let firstKey = null;
    const rows = [];

    while (pages < MAX_PAGES) {
      const page = await fetchPage(client, offset, pageSize);
      pages += 1;

      if (expectedTotal === null) {
        expectedTotal = page.total;
        // 页长被后端截断时自动降级为实际返回条数，再从头抓
        if (page.rows.length > 0 && page.rows.length < pageSize && page.rows.length < expectedTotal) {
          pageSize = page.rows.length;
          rows.length = 0;
          offset = 0;
          pages = 0;
          notify(`每页 ${PAGE_SIZE} 条被后端截断为 ${pageSize} 条，已自动降级重抓…`, 5);
          continue;
        }
        firstKey = page.rows.length ? recordKey(page.rows[0]) : null;
      } else if (page.total !== expectedTotal) {
        throw new Error(`抓取期间产品总数由 ${expectedTotal} 变为 ${page.total}，请稍后重试`);
      }

      rows.push(...page.rows);
      notify(`正在抓取：${Math.min(rows.length, expectedTotal)} / ${expectedTotal}（第 ${pages} 页）`, 10);

      if (rows.length >= expectedTotal) break;
      if (page.rows.length === 0) {
        throw new Error(`分页提前结束：应有 ${expectedTotal} 条，实际只拿到 ${rows.length} 条`);
      }
      offset += pageSize;
    }

    if (pages >= MAX_PAGES && rows.length < expectedTotal) {
      throw new Error('分页数量超过安全上限，已停止抓取');
    }

    // 多页抓取期间若有新产品插入，offset 分页会错位；复查第一页
    if (pages > 1) {
      const verify = await fetchPage(client, 0, pageSize);
      const verifyKey = verify.rows.length ? recordKey(verify.rows[0]) : null;
      if (verify.total !== expectedTotal || verifyKey !== firstKey) {
        throw new Error('抓取期间产品列表发生变化（total 或首行变化），请稍后重试');
      }
    }

    const unique = new Map();
    for (const row of rows) {
      const key = recordKey(row);
      if (!key) throw new Error('接口返回了缺少主键（id / product_id / sku）的产品记录');
      if (!unique.has(key)) unique.set(key, Object.assign({}, row, { _record_key: key }));
    }
    if (unique.size !== expectedTotal) {
      throw new Error(`完整性校验失败：接口 total=${expectedTotal}，去重后 ${unique.size}`);
    }

    return { records: [...unique.values()], total: expectedTotal, pages, pageSize };
  }

  // ------------------------------------------------------------------ 执行

  function assertConfigured() {
    if (!FEATURE.setupComplete) throw new Error('插件尚未完成配置');
    if (!FEATURE.page.test(new URL(location.href))) {
      throw new Error('请在已登录的领星页面运行本插件');
    }
  }

  function makeRunId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function executeOnce(options) {
    const opts = options || {};
    const notify = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    // 状态条与任务进度共用同一个上报点，手动运行和 AI 任务走同一条执行链
    const report = (message, percent, kind) => {
      statusBar(message, kind);
      try {
        notify(message, percent);
      } catch (_) {
        // 进度上报失败不能影响采集本身
      }
    };

    assertConfigured();
    const accountKey = resolveAccountKey();

    report(`正在连接领星页面请求层（${FEATURE.request.transport}）…`, 3);
    const pageClient = await globalThis.LingXingPageClient.connect({
      pageWindow: typeof unsafeWindow === 'object' ? unsafeWindow : window,
      requiredTransports: [FEATURE.request.transport],
      timeoutMs: 15000,
    });

    const result = await collectAll(pageClient, (message, percent) => report(message, percent));
    report(`抓取完成：${result.records.length} 条 / ${result.pages} 页，正在校验桥权限…`, 70, 'ok');

    // 凭据先取一次，避免抓完了才发现没配对
    const bridge = globalThis.LocalAutomationBridge.createLocalBridgeClient({
      clientId: FEATURE.bridge.clientId,
      baseUrl: 'http://127.0.0.1:32145',
      tokenKey: FEATURE.bridge.tokenKey,
    });
    const capabilities = await bridge.capabilities();
    const permission = `dataset:write:${FEATURE.bridge.datasetId}`;
    if (!Array.isArray(capabilities.permissions) || !capabilities.permissions.includes(permission)) {
      throw new Error(`本地桥未授予 ${permission}，请检查 bridge.config.json`);
    }

    const now = new Date();
    const collectedAt = now.toISOString();
    const runId = makeRunId();

    const body = {
      schema_version: 1,
      dataset: FEATURE.bridge.datasetId,
      account_key: accountKey,
      run_id: runId,
      collected_at: collectedAt,
      // 全量采集：只有 full 才允许覆盖基线
      scope: { kind: 'full', fingerprint: 'full', description: { filters: 'none' } },
      snapshot: {
        records: result.records,
        record_count: result.records.length,
        api_total: result.total,
        source: {
          transport: FEATURE.request.transport,
          path: FEATURE.request.path,
          sequence_group: FEATURE.request.sequenceGroup,
          page_size: result.pageSize,
          pages: result.pages,
          collected_from: location.href,
          evidence_sample: '2026-10-21T07:42:07Z',
        },
      },
      export: {
        run_id: runId,
        account_key: accountKey,
        completed_at: collectedAt,
      },
    };

    report(`正在写入本地桥（${result.records.length} 条，${(JSON.stringify(body).length / 1048576).toFixed(1)} MB）…`, 80);
    const ack = await bridge.ingestDataset(FEATURE.bridge.datasetId, body);

    if (Number(ack.record_count) !== result.records.length) {
      throw new Error(`本地桥记录数 ${ack.record_count} 与实际 ${result.records.length} 不一致`);
    }

    const summary = [
      '产品库已落盘',
      `条数：${ack.record_count}（接口 total ${result.total}）`,
      `新增：${ack.added_count === undefined ? '?' : ack.added_count}　移除：${ack.removed_count === undefined ? '?' : ack.removed_count}`,
      '文件：C:\\数据\\领星\\产品数据\\latest.json',
    ].join('\n');
    report(summary, 100, 'ok');
    GM_setValue(LAST_OK_STORE, Date.now());
    GM_setValue(LAST_RESULT_STORE, {
      at: Date.now(),
      count: Number(ack.record_count) || result.records.length,
      total: result.total,
      added: ack.added_count === undefined ? null : ack.added_count,
      removed: ack.removed_count === undefined ? null : ack.removed_count,
      run_id: runId,
      account_key: accountKey,
    });
    hideStatus(15000);
    return {
      ack,
      run_id: runId,
      account_key: accountKey,
      collected_at: collectedAt,
      bridge_committed_at: ack.received_at || new Date().toISOString(),
      dataset_id: FEATURE.bridge.datasetId,
      dataset_path: 'C:\\数据\\领星\\产品数据',
      output_kind: 'full_snapshot',
      source_record_count: result.total,
      record_count: result.records.length,
      pages: result.pages,
      added_count: ack.added_count === undefined ? null : ack.added_count,
      removed_count: ack.removed_count === undefined ? null : ack.removed_count,
    };
  }

  async function runOnce() {
    if (running) {
      panelSetStatus('上一轮采集还没结束，请稍候', 'error');
      return null;
    }
    // 缺账号标识时直接把面板摆出来，而不是弹 prompt
    if (!String(GM_getValue(ACCOUNT_KEY_STORE, '') || '').trim()) {
      openPanel();
      panelSetStatus('还没有设置账号标识：请在上方「账号标识」里填写并保存', 'error');
      return null;
    }
    running = true;
    setRuntimeHeartbeatState('running', '正在手动采集领星产品库');
    panelSetStatus('开始采集全量产品库…');
    try {
      const result = await executeOnce();
      setRuntimeHeartbeatState('idle', `最近一次手动采集已完成：${result.record_count} 条`);
      return result;
    } catch (error) {
      setRuntimeHeartbeatState('error', `手动采集失败：${error?.message || String(error)}`);
      statusBar(`采集失败：${error.message}`, 'error');
      hideStatus(20000);
      return null;
    } finally {
      running = false;
      renderPanel();
    }
  }

  // ------------------------------------------------------------------ AI 实时刷新
  // 本地桥 job 队列的 worker：AI 用 CLI 创建 lingxing.products.refresh 任务，
  // 插件长轮询领取，用同一套 executeOnce 采集落盘，再回报 succeeded。
  // 插件只认这一个能力 ID，任务输入不接受任何 URL / endpoint / 代码。

  function makeBridgeClient() {
    return globalThis.LocalAutomationBridge.createLocalBridgeClient({
      clientId: FEATURE.bridge.clientId,
      baseUrl: 'http://127.0.0.1:32145',
      tokenKey: FEATURE.bridge.tokenKey,
    });
  }

  function runtimeHeartbeatPayload() {
    const payload = {
      instance_id: `products-${runtime.jobWorkerTabId}`,
      state: runtime.runtimeHeartbeatState,
      version: PLUGIN_VERSION,
    };
    const message = String(runtime.runtimeHeartbeatMessage || '')
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, 300);
    if (message) payload.message = message;
    return payload;
  }

  async function sendRuntimeHeartbeat() {
    if (!FEATURE.setupComplete || runtime.jobWorkerStopped) return;
    if (!String(GM_getValue(FEATURE.bridge.tokenKey, '') || '').trim()) return;
    if (runtime.runtimeHeartbeatInFlight) {
      runtime.runtimeHeartbeatPending = true;
      return;
    }
    runtime.runtimeHeartbeatInFlight = true;
    try {
      await makeBridgeClient().runtimeHeartbeat(runtimeHeartbeatPayload());
      runtime.runtimeHeartbeatLastWarningAt = 0;
    } catch (error) {
      const now = Date.now();
      if (!runtime.runtimeHeartbeatLastWarningAt
        || now - runtime.runtimeHeartbeatLastWarningAt >= 60000) {
        runtime.runtimeHeartbeatLastWarningAt = now;
        console.warn('[领星产品库] 无法上报公共状态心跳，业务功能继续运行', error);
      }
    } finally {
      runtime.runtimeHeartbeatInFlight = false;
      if (runtime.runtimeHeartbeatPending && !runtime.jobWorkerStopped) {
        runtime.runtimeHeartbeatPending = false;
        queueMicrotask(() => { void sendRuntimeHeartbeat(); });
      }
    }
  }

  function setRuntimeHeartbeatState(state, message) {
    if (!['idle', 'running', 'error'].includes(state)) {
      throw new Error(`不支持的运行状态：${state}`);
    }
    runtime.runtimeHeartbeatState = state;
    runtime.runtimeHeartbeatMessage = String(message || '');
    void sendRuntimeHeartbeat();
  }

  function startRuntimeHeartbeat() {
    if (!FEATURE.setupComplete || runtime.runtimeHeartbeatTimer) return;
    void sendRuntimeHeartbeat();
    runtime.runtimeHeartbeatTimer = setInterval(
      () => { void sendRuntimeHeartbeat(); },
      RUNTIME_HEARTBEAT_MS,
    );
    window.addEventListener('beforeunload', () => {
      if (runtime.runtimeHeartbeatTimer) clearInterval(runtime.runtimeHeartbeatTimer);
      runtime.runtimeHeartbeatTimer = null;
    }, { once: true });
  }

  function jobError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  async function getJobWorkerId() {
    if (runtime.jobWorkerId) return runtime.jobWorkerId;
    const saved = String(GM_getValue(JOB_WORKER_KEY, '') || '').trim();
    if (/^[a-z0-9][a-z0-9._:@-]{7,159}$/i.test(saved)) {
      runtime.jobWorkerId = saved;
      return saved;
    }
    const pageCrypto = (typeof unsafeWindow === 'object' ? unsafeWindow : window).crypto || crypto;
    const random = typeof pageCrypto?.randomUUID === 'function'
      ? pageCrypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const created = `lingxing-products-userscript:${random}`;
    GM_setValue(JOB_WORKER_KEY, created);
    runtime.jobWorkerId = created;
    return created;
  }

  function validateJob(job) {
    if (job.capability !== JOB_CAPABILITY) {
      throw jobError('CAPABILITY_NOT_ALLOWED', `拒绝执行未登记能力：${job.capability}`);
    }
    const input = job.input;
    if (input !== undefined && input !== null) {
      if (typeof input !== 'object' || Array.isArray(input)) {
        throw jobError('UNSUPPORTED_JOB_INPUT', '产品库刷新能力不接受该任务输入');
      }
      const allowed = new Set(['reason', 'trigger']);
      if (Object.keys(input).some((key) => !allowed.has(key))) {
        throw jobError('UNSUPPORTED_JOB_INPUT', '产品库刷新任务包含未支持的参数');
      }
      for (const key of allowed) {
        if (input[key] !== undefined
          && (typeof input[key] !== 'string' || input[key].length > 200)) {
          throw jobError('UNSUPPORTED_JOB_INPUT', `任务参数 ${key} 必须是 200 字以内的文本`);
        }
      }
    }
  }

  function serializeJobError(error) {
    const message = String(error?.message || error || '产品库刷新失败').slice(0, 1000);
    let code = String(error?.code || '').trim();
    if (!code && message.includes('尚未设置账号标识')) code = 'ACCOUNT_KEY_MISSING';
    if (!code && message.includes('连接领星页面请求层')) code = 'LOGIN_REQUIRED';
    if (!code) code = 'REFRESH_FAILED';
    const requiresUserAction = new Set([
      'ACCOUNT_KEY_MISSING',
      'ACCOUNT_MISMATCH',
      'PERMISSION_DENIED',
      'LOGIN_REQUIRED',
      'LINGXING_CLIENT_TIMEOUT',
      'UNSUPPORTED_JOB_INPUT',
    ]).has(code);
    const retryable = !requiresUserAction && new Set([
      'WORKER_BUSY',
      'REFRESH_FAILED',
      'JOB_DEADLINE_TOO_CLOSE',
      'BRIDGE_ERROR',
      'BRIDGE_HTTP_ERROR',
    ]).has(code);
    return {
      code: code.slice(0, 100),
      message,
      retryable,
      requires_user_action: requiresUserAction,
    };
  }

  function createJobProgressReporter(client, job, workerId) {
    let lastMessage = '任务正在运行';
    let lastPercent;
    let pending = null;
    let draining = null;
    const drain = () => {
      if (draining) return draining;
      draining = (async () => {
        while (pending) {
          const current = pending;
          pending = null;
          try {
            await client.reportJobProgress(job.job_id, job.claimToken, {
              message: current.message.slice(0, 500),
              worker_id: workerId,
              percent: current.percent,
              reported_at: new Date().toISOString(),
            });
          } catch (error) {
            // 进度续约失败不能中断采集；真断线了由租约到期兜底重新领取
            console.warn('[领星产品库] 无法回报任务进度，采集继续', error);
          }
        }
      })().finally(() => {
        draining = null;
        if (pending) drain();
      });
      return draining;
    };
    return {
      notify: (message, percent) => {
        lastMessage = String(message || lastMessage);
        if (Number.isFinite(percent)) lastPercent = percent;
        pending = { message: lastMessage, percent: lastPercent };
        return drain();
      },
      heartbeat: () => {
        pending = { message: lastMessage, percent: lastPercent };
        return drain();
      },
      flush: async () => {
        while (pending || draining) {
          if (draining) await draining;
          else await drain();
        }
      },
    };
  }

  async function handleClaimedJob(client, job, claimToken, workerId) {
    const claimed = { ...job, claimToken };
    runtime.activeBridgeJobId = job.job_id;
    running = true;
    setRuntimeHeartbeatState('running', '正在执行 AI 发起的产品库刷新');
    const reporter = createJobProgressReporter(client, claimed, workerId);
    const heartbeat = setInterval(() => reporter.heartbeat(), 20000);
    let result;
    try {
      try {
        validateJob(job);
        await reporter.notify('浏览器已认领产品库刷新任务', 1);
        const expiresAt = Date.parse(job.expires_at || '');
        if (!Number.isFinite(expiresAt)) {
          throw jobError('JOB_EXPIRY_INVALID', '任务缺少有效的过期时间');
        }
        const latestStartAt = expiresAt - JOB_MIN_RUN_BUDGET_MS - JOB_COMPLETION_RESERVE_MS;
        if (Date.now() >= latestStartAt) {
          throw jobError('JOB_DEADLINE_TOO_CLOSE', '任务剩余时间不足以完成一次采集，请稍后重新发起');
        }
        result = await executeOnce({
          interactive: false,
          onProgress: (message, percent) => reporter.notify(message, percent),
        });
        if (!result || typeof result !== 'object') {
          throw jobError('REFRESH_RESULT_INVALID', '产品库刷新未返回可确认的结果');
        }
      } catch (error) {
        clearInterval(heartbeat);
        const serialized = serializeJobError(error);
        setRuntimeHeartbeatState('error', `AI 发起的产品库刷新失败：${serialized.message}`);
        await reporter.flush();
        try {
          await client.completeJob(job.job_id, claimToken, 'failed', { error: serialized });
        } catch (completionError) {
          console.error('[领星产品库] 任务失败且无法回报完成状态', job.job_id, completionError);
          throw completionError;
        }
        console.warn('[领星产品库] AI 触发任务失败', job.job_id, serialized);
        return;
      }

      // 落盘成功与“成功状态回报”分开：回报临时失败不应把已落盘数据标成失败
      clearInterval(heartbeat);
      await reporter.flush();
      await client.completeJob(job.job_id, claimToken, 'succeeded', {
        result: { capability: JOB_CAPABILITY, worker_id: workerId, ...result },
      });
      setRuntimeHeartbeatState('idle', `最近一次 AI 产品库刷新已完成：${result.record_count} 条`);
      console.info('[领星产品库] AI 触发任务已完成', job.job_id, result.run_id);
    } catch (error) {
      setRuntimeHeartbeatState('error', `产品库任务状态回报失败：${error?.message || String(error)}`);
      throw error;
    } finally {
      clearInterval(heartbeat);
      if (runtime.activeBridgeJobId === job.job_id) runtime.activeBridgeJobId = '';
      running = false;
      renderPanel();
    }
  }

  function jobLeaderStorage() {
    try {
      return (typeof unsafeWindow === 'object' ? unsafeWindow : window).localStorage || localStorage;
    } catch (_) {
      return null;
    }
  }

  function ownsJobLeadership() {
    const storage = jobLeaderStorage();
    if (!storage) return runtime.jobWorkerLeader;
    try {
      const current = JSON.parse(storage.getItem(JOB_LEADER_KEY) || 'null');
      return current?.owner === runtime.jobWorkerTabId && Number(current?.expiresAt) > Date.now();
    } catch (_) {
      return false;
    }
  }

  async function jobWorkerLoop(client, shouldContinue) {
    const workerId = await getJobWorkerId();
    let retryMs = JOB_IDLE_RETRY_MS;
    while (!runtime.jobWorkerStopped && shouldContinue()) {
      // 没配对就没必要长轮询（会 401 刷屏）；用户配对后自动接上
      if (!String(GM_getValue(FEATURE.bridge.tokenKey, '') || '').trim()) {
        await sleep(30000);
        continue;
      }
      if (running) {
        await sleep(1500);
        continue;
      }
      try {
        const claimed = await client.claimJobs([JOB_CAPABILITY], workerId, JOB_CLAIM_WAIT_MS);
        retryMs = JOB_IDLE_RETRY_MS;
        if (!claimed) continue;
        await handleClaimedJob(client, claimed.job, claimed.claimToken, workerId);
      } catch (error) {
        if (runtime.jobWorkerStopped || !shouldContinue()) break;
        console.warn('[领星产品库] 任务轮询暂时不可用，将自动重试', error);
        await sleep(retryMs + Math.floor(Math.random() * 750));
        retryMs = Math.min(retryMs * 2, JOB_ERROR_RETRY_MAX_MS);
      }
    }
  }

  async function runWithLeaderLease() {
    const storage = jobLeaderStorage();
    if (!storage) {
      // 拿不到 localStorage 时退化成"每个标签页都轮询"，桥端租约保证只有一个能领到
      await jobWorkerLoop(makeBridgeClient(), () => !runtime.jobWorkerStopped);
      return;
    }
    while (!runtime.jobWorkerStopped) {
      const now = Date.now();
      let current = null;
      try {
        current = JSON.parse(storage.getItem(JOB_LEADER_KEY) || 'null');
      } catch (_) { current = null; }
      const held = current?.owner && current.owner !== runtime.jobWorkerTabId
        && Number(current.expiresAt) > now;
      if (held) {
        await sleep(5000);
        continue;
      }
      storage.setItem(JOB_LEADER_KEY, JSON.stringify({
        owner: runtime.jobWorkerTabId,
        expiresAt: now + JOB_LEADER_TTL_MS,
      }));
      await sleep(60 + Math.floor(Math.random() * 90));
      if (!ownsJobLeadership()) {
        await sleep(5000);
        continue;
      }
      runtime.jobWorkerLeader = true;
      const beat = setInterval(() => {
        if (!ownsJobLeadership()) {
          runtime.jobWorkerLeader = false;
          clearInterval(beat);
          return;
        }
        try {
          storage.setItem(JOB_LEADER_KEY, JSON.stringify({
            owner: runtime.jobWorkerTabId,
            expiresAt: Date.now() + JOB_LEADER_TTL_MS,
          }));
        } catch (_) {
          runtime.jobWorkerLeader = false;
        }
      }, JOB_LEADER_HEARTBEAT_MS);
      try {
        await jobWorkerLoop(makeBridgeClient(), () => ownsJobLeadership());
      } finally {
        clearInterval(beat);
        runtime.jobWorkerLeader = false;
        try {
          const latest = JSON.parse(storage.getItem(JOB_LEADER_KEY) || 'null');
          if (latest?.owner === runtime.jobWorkerTabId) storage.removeItem(JOB_LEADER_KEY);
        } catch (_) { /* 租约到期自动失效 */ }
      }
      if (!runtime.jobWorkerStopped) await sleep(2000);
    }
  }

  function startJobWorker() {
    if (runtime.jobWorkerStarted) return;
    runtime.jobWorkerStarted = true;
    runtime.jobWorkerStopped = false;
    Promise.resolve(runWithLeaderLease()).catch((error) => {
      console.error('[领星产品库] 任务客户端意外停止', error);
      runtime.jobWorkerStarted = false;
    });
    window.addEventListener('beforeunload', () => {
      runtime.jobWorkerStopped = true;
      runtime.jobWorkerLeader = false;
    }, { once: true });
  }

  async function pair(codeFromPanel) {
    const code = String(codeFromPanel || '').trim();
    if (!code) {
      panelSetStatus('请先填入一次性配对码（可在本地桥用 pair-code 生成）', 'error');
      return false;
    }
    const bridge = makeBridgeClient();
    panelSetStatus('正在配对本地桥…');
    try {
      const result = await bridge.pair(code);
      const permissions = result.permissions || [];
      const ok = permissions.includes(`dataset:write:${FEATURE.bridge.datasetId}`)
        && permissions.includes(`job:execute:${JOB_CAPABILITY}`);
      panelSetStatus(ok
        ? `配对成功：${permissions.join(', ')}`
        : `配对成功但权限不完整：${permissions.join(', ') || '无'}`, ok ? 'ok' : 'error');
      setRuntimeHeartbeatState(
        ok ? 'idle' : 'error',
        ok ? '已配对，等待产品库采集任务' : '配对成功，但产品库权限不完整',
      );
      renderPanel();
      return ok;
    } catch (error) {
      panelSetStatus(`配对失败：${error.message}`, 'error');
      return false;
    }
  }

  // ------------------------------------------------------------------ 页面面板
  // 油猴菜单只留一个「显示功能面板」入口，其余操作全部收进这里，
  // 避免油猴菜单被一个插件的十几个命令塞满。

  const PANEL_ID = 'lxp-root';
  const PANEL_STYLE_ID = 'lxp-styles';

  function formatTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function humanAge(ts) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    if (!Number.isFinite(diff) || diff < 0) return '—';
    const hours = diff / 3600000;
    if (hours < 1) return `${Math.max(1, Math.round(diff / 60000))} 分钟前`;
    if (hours < 48) return `${hours.toFixed(1)} 小时前`;
    return `${(hours / 24).toFixed(1)} 天前`;
  }

  function ensurePanelStyles() {
    if (document.getElementById(PANEL_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = PANEL_STYLE_ID;
    style.textContent = `
      #${PANEL_ID} { position:fixed; right:18px; bottom:18px; z-index:2147483600;
        font:13px/1.55 system-ui,-apple-system,"Microsoft YaHei",sans-serif; color:#1f2937; }
      #${PANEL_ID} .lxp-panel { width:352px; max-height:76vh; overflow:auto; background:#fff; border-radius:14px;
        box-shadow:0 14px 44px rgba(15,23,42,.24); border:1px solid #e5e7eb; }
      #${PANEL_ID} .lxp-head { display:flex; align-items:center; gap:8px; padding:13px 14px;
        border-bottom:1px solid #eef0f5; }
      #${PANEL_ID} .lxp-title { font-weight:700; font-size:14px; }
      #${PANEL_ID} .lxp-badge { font-size:11px; padding:2px 7px; border-radius:999px;
        background:#eef2ff; color:#4338ca; }
      #${PANEL_ID} .lxp-badge.warn { background:#fef3c7; color:#92400e; }
      #${PANEL_ID} .lxp-badge.ok { background:#dcfce7; color:#166534; }
      #${PANEL_ID} .lxp-close { margin-left:auto; border:0; background:transparent; color:#9ca3af;
        font-size:20px; line-height:1; cursor:pointer; padding:0 2px; }
      #${PANEL_ID} .lxp-body { padding:12px 14px 14px; }
      #${PANEL_ID} .lxp-grid { display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; margin-bottom:11px; }
      #${PANEL_ID} .lxp-kv { display:flex; flex-direction:column; }
      #${PANEL_ID} .lxp-kv span { color:#8a8f98; font-size:11px; }
      #${PANEL_ID} .lxp-kv b { font-weight:600; font-size:12px; word-break:break-all; }
      #${PANEL_ID} .lxp-actions { display:flex; gap:8px; margin-bottom:12px; }
      #${PANEL_ID} .lxp-btn { border:0; border-radius:8px; padding:9px 12px; cursor:pointer;
        font-size:12.5px; background:#eef1f6; color:#374151; }
      #${PANEL_ID} .lxp-btn:hover { filter:brightness(.97); }
      #${PANEL_ID} .lxp-btn:disabled { opacity:.5; cursor:not-allowed; }
      #${PANEL_ID} .lxp-primary { background:#4f46e5; color:#fff; flex:1; }
      #${PANEL_ID} .lxp-small { padding:7px 10px; flex:none; }
      #${PANEL_ID} .lxp-section { border-top:1px solid #f1f3f7; padding-top:11px; margin-top:2px; }
      #${PANEL_ID} .lxp-section-title { font-size:12px; font-weight:600; color:#4b5563; margin-bottom:8px; }
      #${PANEL_ID} .lxp-inline { display:flex; gap:6px; margin-bottom:7px; }
      #${PANEL_ID} input[type=text], #${PANEL_ID} input[type=time], #${PANEL_ID} input[type=number] {
        flex:1; min-width:0; padding:7px 9px; border:1px solid #dcdfe6; border-radius:7px;
        font-size:12px; color:#1f2937; background:#fff; }
      #${PANEL_ID} select { padding:7px 9px; border:1px solid #dcdfe6; border-radius:7px;
        font-size:12px; background:#fff; color:#1f2937; }
      #${PANEL_ID} .lxp-opt { display:none; align-items:center; gap:6px; margin-top:7px; font-size:12px; color:#4b5563; }
      #${PANEL_ID} .lxp-opt.on { display:flex; }
      #${PANEL_ID} .lxp-hint { margin-top:8px; font-size:11.5px; color:#909399; line-height:1.6; }
      #${PANEL_ID} .lxp-status { margin-top:11px; padding:8px 10px; border-radius:8px; background:#f4f6fb;
        color:#4b5563; font-size:12px; white-space:pre-wrap; max-height:110px; overflow:auto; }
      #${PANEL_ID} .lxp-status.error { background:#fef2f2; color:#b91c1c; }
      #${PANEL_ID} .lxp-status.ok { background:#f0fdf4; color:#15803d; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function panelOpen() {
    // 面板只在打开时才存在于 DOM 里，关闭即移除
    return Boolean(document.getElementById('lxp-panel'));
  }

  function panelSetStatus(text, kind) {
    // 面板没开时也要记住最近一条状态：用户打开面板能立刻看到上次跳过的原因
    runtime.lastPanelStatus = { text: String(text), kind: kind || '' };
    const el = document.getElementById('lxp-status');
    if (!el) return;
    el.textContent = String(text);
    el.className = 'lxp-status' + (kind === 'error' ? ' error' : kind === 'ok' ? ' ok' : '');
  }

  function renderPanel() {
    if (!document.getElementById('lxp-panel')) return;
    const saved = GM_getValue(LAST_RESULT_STORE, null) || {};
    const lastOk = Number(GM_getValue(LAST_OK_STORE, 0)) || 0;
    const account = String(GM_getValue(ACCOUNT_KEY_STORE, '') || '');
    const paired = Boolean(String(GM_getValue(FEATURE.bridge.tokenKey, '') || '').trim());

    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    set('lxp-count', saved.count ? `${saved.count} 条` : '—');
    set('lxp-last', lastOk ? formatTime(lastOk) : '尚未采集');
    set('lxp-age', lastOk ? humanAge(lastOk) : '—');
    set('lxp-account', account ? account.replace('lingxing:company:', '') : '未设置');

    const badge = document.getElementById('lxp-badge');
    if (badge) {
      badge.textContent = paired ? '桥已配对' : '未配对';
      badge.className = 'lxp-badge ' + (paired ? 'ok' : 'warn');
    }

    const cfg = getAutoConfig();
    const modeSel = document.getElementById('lxp-mode');
    if (modeSel) modeSel.value = cfg.mode;
    const timeInput = document.getElementById('lxp-time');
    if (timeInput) timeInput.value = cfg.time;
    const intervalInput = document.getElementById('lxp-interval');
    if (intervalInput) intervalInput.value = String(cfg.intervalMin);
    const dailyWrap = document.getElementById('lxp-daily-wrap');
    if (dailyWrap) dailyWrap.className = 'lxp-opt' + (cfg.mode === 'daily' ? ' on' : '');
    const intervalWrap = document.getElementById('lxp-interval-wrap');
    if (intervalWrap) intervalWrap.className = 'lxp-opt' + (cfg.mode === 'interval' ? ' on' : '');

    const hint = document.getElementById('lxp-hint');
    if (hint) {
      hint.textContent = cfg.mode === 'off'
        ? '未开启自动采集。关闭状态下只有你手动点，或 AI 通过本地桥发起时才采集。'
        : cfg.mode === 'daily'
          ? `每天 ${cfg.time} 自动采集一次；到点时浏览器没开就在下次打开领星页面时补跑（当天只跑一次）。`
          : `距上次成功满 ${cfg.intervalMin} 分钟自动采集一次；同样需要领星页面开着。`;
    }

    const accountInput = document.getElementById('lxp-account-input');
    if (accountInput && !accountInput.value) {
      accountInput.value = account ? account.replace('lingxing:company:', '') : detectCompanyHint();
    }
  }

  function openPanel() {
    ensurePanelStyles();
    let root = document.getElementById(PANEL_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = PANEL_ID;
      root.innerHTML = `
        <div class="lxp-panel" id="lxp-panel">
          <div class="lxp-head">
            <span class="lxp-title">领星产品库</span>
            <span class="lxp-badge" id="lxp-badge">未配对</span>
            <button class="lxp-close" id="lxp-close" title="关闭面板">×</button>
          </div>
          <div class="lxp-body">
            <div class="lxp-grid">
              <div class="lxp-kv"><span>数据条数</span><b id="lxp-count">—</b></div>
              <div class="lxp-kv"><span>上次采集</span><b id="lxp-last">—</b></div>
              <div class="lxp-kv"><span>数据年龄</span><b id="lxp-age">—</b></div>
              <div class="lxp-kv"><span>账号标识</span><b id="lxp-account">—</b></div>
            </div>
            <div class="lxp-actions">
              <button class="lxp-btn lxp-primary" id="lxp-run">立即采集全量</button>
              <button class="lxp-btn lxp-small" id="lxp-diag">诊断</button>
            </div>
            <div class="lxp-section">
              <div class="lxp-section-title">自动采集</div>
              <select id="lxp-mode">
                <option value="off">关闭</option>
                <option value="daily">每天定时</option>
                <option value="interval">按间隔</option>
              </select>
              <span class="lxp-opt" id="lxp-daily-wrap">每天 <input type="time" id="lxp-time" style="width:96px;flex:none"></span>
              <span class="lxp-opt" id="lxp-interval-wrap">每 <input type="number" id="lxp-interval" min="1" max="240" style="width:66px;flex:none"> 分钟</span>
              <button class="lxp-btn lxp-small" id="lxp-save-auto" style="margin-top:8px">保存设置</button>
              <div class="lxp-hint" id="lxp-hint"></div>
            </div>
            <div class="lxp-section">
              <div class="lxp-section-title">本地桥（首次用一次即可）</div>
              <div class="lxp-inline">
                <input type="text" id="lxp-pair-code" placeholder="一次性配对码">
                <button class="lxp-btn lxp-small" id="lxp-pair">配对</button>
              </div>
              <div class="lxp-inline">
                <input type="text" id="lxp-account-input" placeholder="账号标识（公司ID或简称）">
                <button class="lxp-btn lxp-small" id="lxp-save-account">保存</button>
              </div>
            </div>
            <div class="lxp-status" id="lxp-status">就绪</div>
          </div>
        </div>
      `;
      document.body.appendChild(root);
      bindPanelEvents();
    }
    renderPanel();
    // 面板关着时发生的状态（比如自动采集被跳过）打开后要能看见
    if (runtime.lastPanelStatus) {
      panelSetStatus(runtime.lastPanelStatus.text, runtime.lastPanelStatus.kind);
    }
  }

  // 关闭 = 从 DOM 里彻底移除（连样式一起），页面上不留任何图标，避免遮挡领星页面
  function closePanel() {
    const root = document.getElementById(PANEL_ID);
    if (root) root.remove();
    const style = document.getElementById(PANEL_STYLE_ID);
    if (style) style.remove();
  }

  function togglePanel() {
    if (panelOpen()) closePanel();
    else openPanel();
  }

  function bindPanelEvents() {
    const on = (id, event, handler) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(event, handler);
    };

    on('lxp-close', 'click', () => closePanel());
    on('lxp-run', 'click', () => { void runOnce(); });
    on('lxp-diag', 'click', () => showDiagnostics());

    on('lxp-mode', 'change', () => {
      const mode = document.getElementById('lxp-mode').value;
      const dailyWrap = document.getElementById('lxp-daily-wrap');
      const intervalWrap = document.getElementById('lxp-interval-wrap');
      if (dailyWrap) dailyWrap.className = 'lxp-opt' + (mode === 'daily' ? ' on' : '');
      if (intervalWrap) intervalWrap.className = 'lxp-opt' + (mode === 'interval' ? ' on' : '');
    });

    on('lxp-save-auto', 'click', () => {
      const mode = document.getElementById('lxp-mode').value;
      const time = String(document.getElementById('lxp-time').value || '').trim();
      const intervalRaw = Number(document.getElementById('lxp-interval').value);
      if (mode === 'daily' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
        panelSetStatus('每日定时需要选择有效时间（HH:MM）', 'error');
        return;
      }
      if (mode === 'interval' && (!Number.isFinite(intervalRaw) || intervalRaw < 1 || intervalRaw > 240)) {
        panelSetStatus('间隔必须是 1–240 的整数分钟', 'error');
        return;
      }
      GM_setValue(AUTO_STORE, {
        mode,
        time: time || '09:00',
        intervalMin: Number.isFinite(intervalRaw) ? Math.round(intervalRaw) : 15,
      });
      renderPanel();
      panelSetStatus(mode === 'off'
        ? '已关闭自动采集'
        : mode === 'daily'
          ? `已开启每日自动采集：每天 ${time}`
          : `已开启间隔采集：每 ${Math.round(intervalRaw)} 分钟`, 'ok');
    });

    on('lxp-pair', 'click', () => {
      const input = document.getElementById('lxp-pair-code');
      const code = String((input && input.value) || '').trim();
      if (!code) {
        panelSetStatus('请先填入一次性配对码', 'error');
        return;
      }
      void pair(code).then((ok) => { if (ok && input) input.value = ''; });
    });

    on('lxp-save-account', 'click', () => {
      const input = document.getElementById('lxp-account-input');
      const value = String((input && input.value) || '').trim().replace(/^lingxing:company:/, '');
      if (!value) {
        GM_setValue(ACCOUNT_KEY_STORE, '');
        renderPanel();
        panelSetStatus('已清除账号标识；未设置时不会采集', 'error');
        return;
      }
      GM_setValue(ACCOUNT_KEY_STORE, `lingxing:company:${value}`);
      renderPanel();
      panelSetStatus(`账号标识已保存：lingxing:company:${value}`, 'ok');
    });
  }

  // 页面加载时**不创建任何 DOM**：默认关闭，也不记忆上次的开关状态。
  // 想看面板就走油猴菜单「显示功能面板」，看完点 × 彻底移除。

  // ------------------------------------------------------------------ 自动采集
  // 两种模式：每天定时（类似 FBA 插件）/ 按间隔。默认关闭——
  // 自动发请求属于"改变网站状态"的行为，必须由用户显式开启。

  function getAutoConfig() {
    const saved = GM_getValue(AUTO_STORE, null) || {};
    const hasSaved = Object.keys(saved).length > 0;
    // 兼容旧结构 { enabled, intervalMin }
    let mode = saved.mode;
    if (!mode) {
      // 从没配置过 → 默认每天 09:00 采一次（和 FBA 插件的默认一致）；
      // 用户显式关过（有旧配置且 enabled=false）就保持关闭，不擅自打开
      mode = hasSaved ? (saved.enabled === true ? 'interval' : 'off') : 'daily';
    }
    if (!['off', 'daily', 'interval'].includes(mode)) mode = 'off';
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(saved.time || '')) ? String(saved.time) : '09:00';
    const minutes = Number(saved.intervalMin);
    return {
      mode,
      time,
      intervalMin: Number.isFinite(minutes) && minutes >= 1 && minutes <= 240 ? Math.round(minutes) : 15,
    };
  }

  function todayScheduledMs(timeText) {
    const [hour, minute] = String(timeText).split(':').map(Number);
    const scheduled = new Date();
    scheduled.setHours(hour, minute, 0, 0);
    return scheduled.getTime();
  }

  function autoDue(cfg) {
    const lastOk = Number(GM_getValue(LAST_OK_STORE, 0)) || 0;
    if (cfg.mode === 'daily') {
      const scheduled = todayScheduledMs(cfg.time);
      if (Date.now() < scheduled) return false;
      return lastOk < scheduled;   // 今天到点后还没成功过 → 补跑
    }
    if (cfg.mode === 'interval') {
      return Date.now() - lastOk >= cfg.intervalMin * 60000;
    }
    return false;
  }

  // 多个标签页都可能到点，用 localStorage 抢一个短租约，避免同时打两次接口
  function acquireAutoLock() {
    try {
      const storage = (typeof unsafeWindow === 'object' ? unsafeWindow : window).localStorage;
      if (!storage) return true;
      const key = 'lx_products_auto_lock_v1';
      const now = Date.now();
      const current = JSON.parse(storage.getItem(key) || 'null');
      if (current && current.owner !== runtime.jobWorkerTabId && Number(current.expiresAt) > now) {
        return false;
      }
      storage.setItem(key, JSON.stringify({ owner: runtime.jobWorkerTabId, expiresAt: now + 10 * 60000 }));
      return true;
    } catch (_) {
      return true;
    }
  }

  function releaseAutoLock() {
    try {
      const storage = (typeof unsafeWindow === 'object' ? unsafeWindow : window).localStorage;
      if (!storage) return;
      const key = 'lx_products_auto_lock_v1';
      const current = JSON.parse(storage.getItem(key) || 'null');
      if (current?.owner === runtime.jobWorkerTabId) storage.removeItem(key);
    } catch (_) { /* 租约到期自动失效 */ }
  }

  async function autoTick() {
    const cfg = getAutoConfig();
    if (cfg.mode === 'off' || running) return;
    if (runtime.activeBridgeJobId) return;   // AI 任务正在跑，别抢
    if (Date.now() < runtime.nextAutoAttemptAt) return;

    let url;
    try {
      url = new URL(location.href);
    } catch (_) {
      return;
    }
    if (!FEATURE.page.test(url)) return;
    if (!String(GM_getValue(ACCOUNT_KEY_STORE, '') || '').trim()) {
      panelSetStatus('自动采集已跳过：还没有设置账号标识', 'error');
      return;
    }
    if (!String(GM_getValue(FEATURE.bridge.tokenKey, '') || '').trim()) {
      panelSetStatus('自动采集已跳过：本地桥尚未配对', 'error');
      return;
    }
    if (!autoDue(cfg)) return;
    if (!acquireAutoLock()) return;   // 别的标签页正在跑

    const label = cfg.mode === 'daily' ? `每日定时采集（${cfg.time}）` : `间隔采集（每 ${cfg.intervalMin} 分钟）`;
    running = true;
    setRuntimeHeartbeatState('running', `${label}正在运行`);
    try {
      panelSetStatus(`${label}开始…`);
      const result = await executeOnce({ interactive: false });
      setRuntimeHeartbeatState('idle', `${label}已完成：${result.record_count} 条`);
      panelSetStatus(`${label}完成：${result.record_count} 条（新增 ${result.added_count ?? '?'} / 移除 ${result.removed_count ?? '?'}）`, 'ok');
    } catch (error) {
      // 自动运行不弹窗，失败后 30 分钟内不重试，避免反复打领星接口
      runtime.nextAutoAttemptAt = Date.now() + 30 * 60000;
      setRuntimeHeartbeatState('error', `${label}失败：${error?.message || String(error)}`);
      panelSetStatus(`${label}失败：${error.message}\n30 分钟内不再自动重试`, 'error');
      statusBar(`自动采集失败：${error.message}`, 'error');
      hideStatus(20000);
    } finally {
      running = false;
      releaseAutoLock();
      renderPanel();
    }
  }

  function startAutoLoop() {
    // 与 FBA 插件一致：每分钟巡检，到点才真正执行
    setInterval(() => { void autoTick(); }, 60 * 1000);
    setTimeout(() => { void autoTick(); }, 8000);
  }

  function showDiagnostics() {
    const lines = [];
    let clientDiag = null;
    try {
      const pageClient = globalThis.LingXingPageClient.find({
        pageWindow: typeof unsafeWindow === 'object' ? unsafeWindow : window,
        requiredTransports: [FEATURE.request.transport],
      });
      clientDiag = pageClient.diagnostics();
    } catch (error) {
      lines.push(`页面请求层：不可用（${error.message}）`);
    }
    if (clientDiag) {
      lines.push(`页面：${clientDiag.page.pathname}`);
      lines.push(`可用传输层：${clientDiag.availableTransports.join(', ') || '无'}`);
      lines.push(`插件要求：${clientDiag.requiredTransports.join(', ')}`);
    }
    const cfg = getAutoConfig();
    lines.push(`接口：${FEATURE.request.transport} ${FEATURE.request.path}`);
    lines.push(`AI 刷新能力：${JOB_CAPABILITY}`);
    lines.push(`任务轮询：${runtime.jobWorkerStarted ? (runtime.jobWorkerLeader ? '运行中（本页负责领取）' : '运行中（待命）') : '未启动'}`);
    lines.push(`当前任务：${runtime.activeBridgeJobId || '无'}`);
    lines.push(`自动采集：${cfg.mode === 'off' ? '关闭' : cfg.mode === 'daily' ? `每天 ${cfg.time}` : `每 ${cfg.intervalMin} 分钟`}`);
    lines.push(`账号标识：${String(GM_getValue(ACCOUNT_KEY_STORE, '') || '未设置')}`);
    const text = lines.join('\n');
    if (!panelOpen()) openPanel();
    panelSetStatus(text);
  }

  // 油猴菜单只保留一个入口，其余功能都在面板里
  GM_registerMenuCommand(`${FEATURE.title}：显示功能面板`, togglePanel);

  startAutoLoop();
  startJobWorker();
  startRuntimeHeartbeat();
}());
