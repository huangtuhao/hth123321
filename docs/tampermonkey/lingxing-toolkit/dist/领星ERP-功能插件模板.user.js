// ==UserScript==
// @name         领星ERP-功能插件模板（请复制后改名）
// @namespace    local.lingxing.toolkit
// @version      1.1.0
// @description  领星内部请求与本地桥的安全开发模板；占位配置完成前不会执行。
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
 * 使用顺序：
 * 1. 先用“领星ERP-接口探针”取得真实请求样本，禁止猜接口或认证头。
 * 2. 为本功能登记独立 client / dataset / config / artifact 最小权限。
 * 3. 填完 FEATURE，增加业务层分页、完整性与字段验证，再把 setupComplete 改为 true。
 * 4. 同步修改 FEATURE.version；模板会自动向公共状态中心上报 idle/running/error。
 * 5. 此文件已内嵌固定版本 SDK，最终插件不要依赖远程 @require。
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

(function lingxingFeatureTemplate() {
  'use strict';

  let running = false;
  const runtimePresence = {
    instanceId: `feature-tab:${typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    state: 'idle',
    message: '已加载，等待任务',
    timer: null,
    inFlight: false,
    pending: false,
    lastWarningAt: 0,
  };

  const FEATURE = Object.freeze({
    setupComplete: false,
    id: 'replace_me',
    title: '请替换功能名称',
    version: '0.1.0',
    page: {
      test(url) {
        return url.origin === 'https://erp.lingxing.com' && url.pathname === '/replace-me';
      },
    },
    request: {
      // 只能取 post / gwPost / gateGet / gatePost 之一；必须来自探针证据。
      transport: 'post',
      path: '/replace-me',
      sequenceGroup: null,
      buildPayload() {
        return {};
      },
      buildConfig() {
        // 例如二进制下载可返回 { responseType: 'arraybuffer' }。
        return {};
      },
    },
    bridge: {
      clientId: 'replace_me_client',
      tokenKey: 'replace_me_bridge_token',
      // 没有业务需要就保持 null；不要申请无关权限。
      datasetId: null,
      artifactBucket: null,
    },
  });

  function assertConfigured() {
    if (!FEATURE.setupComplete) {
      throw new Error('模板尚未完成配置；请先按文件头注释完成适配。');
    }
    if (!FEATURE.page.test(new URL(location.href))) {
      throw new Error('当前页面不属于本功能允许的页面。');
    }
  }

  function createBridge() {
    return globalThis.LocalAutomationBridge.createLocalBridgeClient({
      clientId: FEATURE.bridge.clientId,
      baseUrl: 'http://127.0.0.1:32145',
      tokenKey: FEATURE.bridge.tokenKey,
    });
  }

  function runtimeHeartbeatPayload() {
    const payload = {
      instance_id: runtimePresence.instanceId,
      state: runtimePresence.state,
      version: FEATURE.version,
    };
    const message = String(runtimePresence.message || '')
      .replace(/[\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, 300);
    if (message) payload.message = message;
    return payload;
  }

  async function sendRuntimeHeartbeat() {
    // 未完成模板永远不访问本地桥；未配对时也保持安静。
    if (!FEATURE.setupComplete) return;
    const token = await Promise.resolve(GM_getValue(FEATURE.bridge.tokenKey, ''));
    if (typeof token !== 'string' || !token.trim()) return;
    if (runtimePresence.inFlight) {
      runtimePresence.pending = true;
      return;
    }
    runtimePresence.inFlight = true;
    try {
      await createBridge().runtimeHeartbeat(runtimeHeartbeatPayload());
      runtimePresence.lastWarningAt = 0;
    } catch (error) {
      const now = Date.now();
      if (!runtimePresence.lastWarningAt || now - runtimePresence.lastWarningAt >= 60000) {
        runtimePresence.lastWarningAt = now;
        console.warn(`[${FEATURE.title}] 无法上报公共状态心跳，业务功能继续运行`, error);
      }
    } finally {
      runtimePresence.inFlight = false;
      if (runtimePresence.pending) {
        runtimePresence.pending = false;
        queueMicrotask(() => { void sendRuntimeHeartbeat(); });
      }
    }
  }

  function setRuntimeState(state, message) {
    if (!['idle', 'running', 'error'].includes(state)) {
      throw new Error(`不支持的运行状态：${state}`);
    }
    runtimePresence.state = state;
    runtimePresence.message = String(message || '');
    void sendRuntimeHeartbeat();
  }

  function startRuntimeHeartbeat() {
    if (!FEATURE.setupComplete || runtimePresence.timer) return;
    void sendRuntimeHeartbeat();
    runtimePresence.timer = setInterval(() => { void sendRuntimeHeartbeat(); }, 20000);
    window.addEventListener('beforeunload', () => {
      if (runtimePresence.timer) clearInterval(runtimePresence.timer);
      runtimePresence.timer = null;
    }, { once: true });
  }

  async function callLingXing(pageClient) {
    const { transport, path, sequenceGroup } = FEATURE.request;
    const payload = FEATURE.request.buildPayload();
    const config = FEATURE.request.buildConfig();
    if (transport === 'post') return pageClient.post(path, payload, { sequenceGroup });
    if (transport === 'gwPost') return pageClient.gwPost(path, payload);
    if (transport === 'gateGet') return pageClient.gateGet(path, config);
    if (transport === 'gatePost') return pageClient.gatePost(path, payload, config);
    throw new Error(`不支持的领星 transport：${transport}`);
  }

  async function executeOnce() {
    assertConfigured();

    const pageClient = await globalThis.LingXingPageClient.connect({
      pageWindow: typeof unsafeWindow === 'object' ? unsafeWindow : window,
      requiredTransports: [FEATURE.request.transport],
      timeoutMs: 15000,
    });

    const raw = await callLingXing(pageClient);
    // TODO：在这里做严格的响应结构、分页总数、稳定主键、账号和筛选范围校验。
    // TODO：只有“完整快照”才能覆盖完整基线；筛选结果必须使用独立 scope。

    if (!FEATURE.bridge.datasetId && !FEATURE.bridge.artifactBucket) return raw;

    const bridge = createBridge();
    const capabilities = await bridge.capabilities();
    // TODO：先验证 capabilities 中确实存在本功能需要的资源，再写入。
    void capabilities;
    // TODO：按资源类型调用 bridge.ingestDataset(...) 或 bridge.uploadArtifact(...)。
    return raw;
  }

  async function runOnce() {
    if (running) throw new Error('上一轮尚未完成；为避免重复请求，本次未执行。');
    running = true;
    setRuntimeState('running', `正在运行：${FEATURE.title}`);
    try {
      const result = await executeOnce();
      setRuntimeState('idle', `最近一次运行已完成：${FEATURE.title}`);
      return result;
    } catch (error) {
      setRuntimeState('error', `运行失败：${error?.message || String(error)}`);
      throw error;
    } finally {
      running = false;
    }
  }

  async function pair() {
    assertConfigured();
    const code = prompt('请输入本地桥一次性配对码：');
    if (!code) return;
    const bridge = createBridge();
    await bridge.pair(code.trim());
    setRuntimeState('idle', `已配对，等待运行：${FEATURE.title}`);
    alert(`${FEATURE.title}：配对成功`);
  }

  GM_registerMenuCommand(`${FEATURE.title}：运行一次`, () => {
    runOnce().catch((error) => alert(`${FEATURE.title}：${error.message}`));
  });
  GM_registerMenuCommand(`${FEATURE.title}：桥接配对`, () => {
    pair().catch((error) => alert(`${FEATURE.title}：${error.message}`));
  });
  startRuntimeHeartbeat();
}());
