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
