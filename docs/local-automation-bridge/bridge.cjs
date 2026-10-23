'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createFbaShipmentsAdapter } = require('./adapters/fba-shipments.cjs');
const { createProductsAdapter } = require('./adapters/products.cjs');
const { AuthStore } = require('./lib/auth-store.cjs');
const { publishConfig, readCurrent } = require('./lib/config-store.cjs');
const { uploadArtifact } = require('./lib/artifact-store.cjs');
const { JobStore } = require('./lib/job-store.cjs');
const { RuntimeStore } = require('./lib/runtime-store.cjs');
const {
  HttpError,
  SerialQueue,
  isLoopbackRequest,
  isPlainObject,
  parseJsonBuffer,
  readRequestBuffer,
  sendJson,
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
} = require('./lib/common.cjs');
const { hasPermission, loadRegistry, resolveClient } = require('./lib/registry.cjs');

const BRIDGE_VERSION = '1.2.0';
const LEGACY_PROTOCOL_VERSION = 1;
const PROTOCOL_VERSION = 2;
const REQUEST_TIMEOUT_MS = 120_000;

function assertContentType(request, prefix) {
  const contentType = String(request.headers['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith(prefix)) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', `Content-Type 必须是 ${prefix}`);
  }
}

function extractToken(request) {
  const genericHeader = request.headers['x-local-bridge-token'];
  if (typeof genericHeader === 'string' && genericHeader) return genericHeader;
  const legacyHeader = request.headers['x-lingxing-bridge-token'];
  if (typeof legacyHeader === 'string' && legacyHeader) return legacyHeader;
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return '';
}

function extractClientHint(request) {
  const value = request.headers['x-local-bridge-client']
    ?? request.headers['x-lingxing-bridge-client'];
  return typeof value === 'string' ? value : '';
}

function validateHostHeader(request) {
  const host = String(request.headers.host ?? '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) {
    throw new HttpError(403, 'INVALID_HOST', 'Host 不是本机回环地址');
  }
}

function validateOrigin(request, client) {
  const origin = String(request.headers.origin ?? '');
  if (!origin || origin === 'null' || !/^https?:\/\//i.test(origin)) return;
  if (client.allowedOrigins.length && !client.allowedOrigins.includes(origin)) {
    throw new HttpError(403, 'ORIGIN_DENIED', '请求页面不在该客户端的来源白名单中');
  }
}

function requestId(request) {
  const supplied = request.headers['x-request-id'];
  return typeof supplied === 'string' && /^[a-z0-9._-]{1,128}$/i.test(supplied)
    ? supplied
    : crypto.randomUUID();
}

function legacyDefaultClient(registry) {
  return Object.values(registry.clients).find((client) => client.pairing === 'legacy_auto') ?? null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeAdapter(definition) {
  if (definition.adapter === 'fba_shipments_v1') {
    return createFbaShipmentsAdapter({
      id: definition.id,
      name: definition.name,
      rootDir: definition.rootDir,
      folder: definition.folder,
      bridgeVersion: BRIDGE_VERSION,
    });
  }
  if (definition.adapter === 'products_v1') {
    return createProductsAdapter({
      id: definition.id,
      name: definition.name,
      rootDir: definition.rootDir,
      folder: definition.folder,
    });
  }
  throw new Error(`数据集 ${definition.id} 使用了未知 adapter：${definition.adapter}`);
}

async function publishLocalCatalog(registry, configPath) {
  const sharedStore = registry.stores.shared;
  if (!sharedStore) return;
  const guideDir = path.join(sharedStore.rootDir, '_说明');
  const guides = {
    start_here: {
      source: path.join(__dirname, 'AI网页能力旁路-使用说明.md'),
      target: path.join(guideDir, 'AI网页能力旁路-使用说明.md'),
    },
    bridge_technical: {
      source: path.join(__dirname, '本地自动化桥-技术接入说明.md'),
      target: path.join(guideDir, '本地自动化桥-技术接入说明.md'),
    },
    compatibility: {
      source: path.join(__dirname, 'AI接入说明.md'),
      target: path.join(guideDir, '本地自动化桥-AI接入说明.md'),
    },
  };
  for (const guide of Object.values(guides)) {
    try {
      await writeTextAtomic(guide.target, await fs.readFile(guide.source, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const relativeGuidePath = (guide) => path.relative(sharedStore.rootDir, guide.target)
    .split(path.sep).join('/');
  const resourceView = (collection) => Object.values(collection).map((resource) => ({
    id: resource.id,
    name: resource.name,
    store: resource.storeId,
    path: resource.resourcePath,
  }));
  await writeJsonAtomic(path.join(sharedStore.rootDir, 'catalog.json'), {
    schema_version: 1,
    service: 'local-automation-bridge',
    bridge_version: BRIDGE_VERSION,
    generated_at: new Date().toISOString(),
    purpose: '供本地 AI 和脚本发现已登记资源，并在 MCP 或正式接口能力不足时找到网页旁路；浏览器客户端应使用 /v2/capabilities。',
    start_here: relativeGuidePath(guides.start_here),
    documentation: relativeGuidePath(guides.compatibility),
    guides: {
      ai_web_fallback: relativeGuidePath(guides.start_here),
      bridge_technical: relativeGuidePath(guides.bridge_technical),
    },
    fallback_trigger: '当现有 MCP、连接器或正式接口缺少任务所需的网站数据或操作时，不要直接停止；先读取 start_here。',
    module_path: __dirname,
    cli_path: path.join(__dirname, 'bridge-cli.cjs'),
    registry_path: configPath,
    sdk_path: path.join(__dirname, 'sdk', 'bridge-client.js'),
    examples: {
      freight_channels: path.join(__dirname, 'examples', 'freight-channels.example.json'),
      userscript_template: path.join(__dirname, 'examples', 'userscript-template.user.js'),
    },
    lingxing_toolkit: {
      development_guide: path.resolve(__dirname, '..', 'tampermonkey', '领星油猴插件开发说明.md'),
      request_probe: path.resolve(__dirname, '..', 'tampermonkey', '领星ERP-接口探针.user.js'),
      page_client_sdk: path.resolve(__dirname, '..', 'tampermonkey', 'lingxing-toolkit', 'lib', 'lingxing-page-client.js'),
      feature_template: path.resolve(__dirname, '..', 'tampermonkey', 'lingxing-toolkit', 'dist', '领星ERP-功能插件模板.user.js'),
    },
    stores: Object.values(registry.stores).map((store) => ({
      id: store.id,
      name: store.name,
      root: store.rootDir,
    })),
    resources: {
      datasets: resourceView(registry.datasets),
      configs: resourceView(registry.configs),
      artifact_buckets: resourceView(registry.artifactBuckets),
    },
    job_capabilities: Object.values(registry.jobCapabilities).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      mode: capability.mode,
      input_mode: capability.inputMode,
      requires_confirmation: capability.confirmationRequired,
    })),
    job_queue: {
      cli: `node ${path.join(__dirname, 'bridge-cli.cjs')} job run <capability> --wait`,
      note: '仅可创建注册表中明确登记的能力；接口探针不会领取任务，只有取得对应 job:execute 权限的正式插件才会执行；浏览器关闭或未登录时任务会保持等待直至过期。',
    },
    runtime_presence: {
      heartbeat_path: '/v2/runtime/heartbeat',
      status_path: '/v2/runtime/status',
      ttl_seconds: registry.service.runtimePresenceTtlSeconds,
      note: '业务插件只上报 instance_id/state/version/message；身份、能力和当前任务由桥端推导。公共状态中心按客户端聚合多个标签页。',
    },
  });
}

async function createBridge(options = {}) {
  const { configPath, registry } = loadRegistry({
    configPath: options.configPath,
    raw: options.registryRaw,
    env: options.env,
    host: options.host,
    port: options.port,
    maxBodyBytes: options.maxBodyBytes,
    stateRoot: options.stateRoot,
    legacyRoot: options.legacyRoot ?? options.rootDir,
    sharedRoot: options.sharedRoot,
  });
  for (const store of Object.values(registry.stores)) {
    await fs.mkdir(store.rootDir, { recursive: true });
  }
  await publishLocalCatalog(registry, configPath);
  const auth = new AuthStore(registry, {
    staticToken: options.token,
    legacyTokenOverride: options.legacyToken ?? process.env.LINGXING_BRIDGE_TOKEN,
  });
  await auth.init();
  const jobs = new JobStore(registry);
  await jobs.init();
  const runtime = new RuntimeStore(registry, {
    ttlSeconds: registry.service.runtimePresenceTtlSeconds,
    now: options.runtimeNow,
  });
  const adapters = Object.create(null);
  for (const dataset of Object.values(registry.datasets)) adapters[dataset.id] = makeAdapter(dataset);
  const storeQueues = Object.create(null);
  for (const store of Object.values(registry.stores)) storeQueues[store.id] = new SerialQueue();
  const startedAt = new Date();

  const authenticate = async (request, optionsForAuth = {}) => {
    let client = resolveClient(registry, extractClientHint(request));
    if (!client && optionsForAuth.legacyDefault) client = legacyDefaultClient(registry);
    if (!client || !(await auth.authenticate(client, extractToken(request)))) {
      throw new HttpError(401, 'UNAUTHORIZED', '客户端身份或令牌不正确');
    }
    validateOrigin(request, client);
    return client;
  };

  const requirePermission = (client, permission) => {
    if (!hasPermission(client, permission)) {
      throw new HttpError(403, 'PERMISSION_DENIED', `客户端无权执行 ${permission}`);
    }
  };

  const jobActions = (client, capabilityId) => ['create', 'read', 'execute']
    .filter((action) => hasPermission(client, `job:${action}:${capabilityId}`));

  const visibleJobCapabilities = (client) => jobs.listCapabilities()
    .map((capability) => ({ ...capability, actions: jobActions(client, capability.id) }))
    .filter((capability) => capability.actions.length > 0);

  const requireJobReadAccess = (client, job) => {
    const ownJob = job.creator?.type === 'client' && job.creator.id === client.id;
    const claimedJob = job.claimed_by === client.id;
    if (
      !ownJob
      && !claimedJob
      && !hasPermission(client, `job:read:${job.capability}`)
    ) {
      throw new HttpError(403, 'PERMISSION_DENIED', `客户端无权读取任务能力 ${job.capability}`);
    }
  };

  const ingestDataset = async ({ request, dataset, client, legacy }) => {
    requirePermission(client, `dataset:write:${dataset.id}`);
    assertContentType(request, 'application/json');
    const rawBody = await readRequestBuffer(request, registry.service.maxBodyBytes);
    const body = parseJsonBuffer(rawBody);
    if ((body.dataset ?? body.dataset_id) !== dataset.id) {
      throw new HttpError(400, 'UNKNOWN_DATASET', '请求体 dataset 与接口资源不一致');
    }
    const receivedAt = new Date().toISOString();
    const adapter = adapters[dataset.id];
    const ingest = adapter.validate({
      body,
      receivedAt,
      payloadSha256: sha256(rawBody),
    });
    const result = await storeQueues[dataset.storeId].run(() => adapter.persist(ingest));
    return {
      statusCode: result.duplicate ? 200 : 201,
      body: {
        ok: true,
        committed: true,
        protocol_version: legacy ? LEGACY_PROTOCOL_VERSION : PROTOCOL_VERSION,
        dataset_id: result.dataset,
        ...(legacy ? {
          data_root: dataset.rootDir,
          dataset_path: dataset.resourcePath,
        } : {}),
        ...result,
      },
    };
  };

  const server = http.createServer((request, response) => {
    const currentRequestId = requestId(request);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error('请求超时')));
    void (async () => {
      if (!isLoopbackRequest(request)) {
        throw new HttpError(403, 'LOOPBACK_ONLY', '只接受本机回环连接');
      }
      validateHostHeader(request);
      const requestUrl = new URL(request.url, `http://${registry.service.host}:${registry.service.port}`);
      if (request.method === 'OPTIONS') {
        throw new HttpError(403, 'CORS_DISABLED', '本地桥不接受普通网页跨域调用');
      }

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        const legacyDataset = registry.datasets.fba_shipments ?? null;
        const datasets = Object.create(null);
        for (const dataset of Object.values(registry.datasets)) {
          datasets[dataset.id] = {
            id: dataset.id,
            name: dataset.name,
            folder: dataset.folder,
            path: dataset.resourcePath,
          };
        }
        sendJson(response, 200, {
          ok: true,
          service: 'lingxing-local-bridge',
          service_id: 'local-automation-bridge',
          version: BRIDGE_VERSION,
          protocol_version: LEGACY_PROTOCOL_VERSION,
          api_versions: [LEGACY_PROTOCOL_VERSION, PROTOCOL_VERSION],
          writable: true,
          host: registry.service.host,
          data_root: legacyDataset?.rootDir ?? null,
          dataset_path: legacyDataset?.resourcePath ?? null,
          datasets,
          token_required: true,
          started_at: startedAt.toISOString(),
          uptime_seconds: Math.floor(process.uptime()),
          runtime_summary: runtime.summary(),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/pair') {
        const client = resolveClient(registry, extractClientHint(request));
        if (!client || client.pairing !== 'legacy_auto') {
          throw new HttpError(403, 'PAIRING_DENIED', '兼容配对客户端标识不正确');
        }
        validateOrigin(request, client);
        if (request.headers['content-length'] || request.headers['transfer-encoding']) {
          const pairBuffer = await readRequestBuffer(request, 64 * 1024);
          if (pairBuffer.length) {
            const pairBody = parseJsonBuffer(pairBuffer);
            if (
              (pairBody.protocol_version !== undefined && Number(pairBody.protocol_version) !== 1)
              || (pairBody.client !== undefined && resolveClient(registry, pairBody.client) !== client)
            ) {
              throw new HttpError(400, 'PAIRING_MISMATCH', '兼容配对请求体与客户端不一致');
            }
          }
        }
        const token = await auth.getLegacyToken(client);
        sendJson(response, 200, {
          ok: true,
          service: 'lingxing-local-bridge',
          service_id: 'local-automation-bridge',
          protocol_version: LEGACY_PROTOCOL_VERSION,
          token,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/ingest') {
        const client = await authenticate(request, { legacyDefault: true });
        const dataset = registry.datasets.fba_shipments;
        if (!dataset) throw new HttpError(503, 'RESOURCE_UNAVAILABLE', 'FBA 兼容数据集未注册');
        const result = await ingestDataset({ request, dataset, client, legacy: true });
        sendJson(response, result.statusCode, result.body);
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v2/pair') {
        assertContentType(request, 'application/json');
        const pairBody = parseJsonBuffer(await readRequestBuffer(request, 64 * 1024));
        const client = resolveClient(registry, pairBody.client_id ?? extractClientHint(request));
        if (!client) throw new HttpError(403, 'PAIRING_DENIED', '客户端未注册');
        validateOrigin(request, client);
        const paired = await auth.consumePairCode(client, pairBody.pairing_code, pairBody.instance_id);
        sendJson(response, 200, {
          ok: true,
          protocol_version: PROTOCOL_VERSION,
          client_id: client.id,
          token: paired.token,
          issued_at: paired.issuedAt,
          permissions: client.permissions,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v2/capabilities') {
        const client = await authenticate(request);
        const visible = (resourceType, collection) => Object.values(collection)
          .filter((resource) => {
            if (resourceType === 'dataset') {
              return hasPermission(client, `dataset:write:${resource.id}`);
            }
            if (resourceType === 'config') {
              return hasPermission(client, `config:read:${resource.id}`)
                || hasPermission(client, `config:write:${resource.id}`);
            }
            return hasPermission(client, `artifact:write:${resource.id}`);
          })
          .map((resource) => ({ id: resource.id, name: resource.name, type: resourceType }));
        sendJson(response, 200, {
          ok: true,
          protocol_version: PROTOCOL_VERSION,
          client: { id: client.id, name: client.name },
          permissions: client.permissions,
          resources: {
            datasets: visible('dataset', registry.datasets),
            configs: visible('config', registry.configs),
            artifact_buckets: visible('artifact_bucket', registry.artifactBuckets),
          },
          job_capabilities: visibleJobCapabilities(client),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v2/runtime/heartbeat') {
        const client = await authenticate(request);
        assertContentType(request, 'application/json');
        const body = parseJsonBuffer(await readRequestBuffer(request, 16 * 1024));
        const instance = runtime.heartbeat(client, body);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          runtime: instance,
        });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/v2/runtime/status') {
        const client = await authenticate(request);
        requirePermission(client, 'runtime:read');
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          runtime: runtime.snapshot(),
        });
        return;
      }

      if (
        request.method === 'GET'
        && (requestUrl.pathname === '/v2/job-capabilities' || requestUrl.pathname === '/v2/jobs/capabilities')
      ) {
        const client = await authenticate(request);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          job_capabilities: visibleJobCapabilities(client),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v2/jobs') {
        const client = await authenticate(request);
        assertContentType(request, 'application/json');
        const body = parseJsonBuffer(await readRequestBuffer(request, registry.service.maxBodyBytes));
        requirePermission(client, `job:create:${body.capability}`);
        const result = await jobs.create(body, { creator: { type: 'client', id: client.id } });
        sendJson(response, result.duplicate ? 200 : 201, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          duplicate: result.duplicate,
          job: result.job,
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v2/jobs/claim') {
        const client = await authenticate(request);
        assertContentType(request, 'application/json');
        const body = parseJsonBuffer(await readRequestBuffer(request, 64 * 1024));
        if (!isPlainObject(body)) throw new HttpError(400, 'INVALID_JOB_CLAIM', '领取请求必须是 JSON 对象');
        const executable = Object.values(registry.jobCapabilities)
          .filter((capability) => hasPermission(client, `job:execute:${capability.id}`))
          .map((capability) => capability.id);
        if (!executable.length) {
          throw new HttpError(403, 'PERMISSION_DENIED', '客户端没有可执行的任务能力');
        }
        const requested = body.capabilities === undefined ? executable : body.capabilities;
        if (!Array.isArray(requested) || requested.length === 0 || requested.some((id) => typeof id !== 'string')) {
          throw new HttpError(400, 'INVALID_JOB_CLAIM', 'capabilities 必须是非空字符串数组');
        }
        const capabilityIds = [...new Set(requested)];
        for (const capabilityId of capabilityIds) {
          if (!registry.jobCapabilities[capabilityId]) {
            throw new HttpError(404, 'CAPABILITY_NOT_FOUND', `任务能力未注册：${capabilityId}`);
          }
          requirePermission(client, `job:execute:${capabilityId}`);
        }
        const workerId = body.worker_id === undefined ? client.id : body.worker_id;
        if (
          typeof workerId !== 'string'
          || !/^[a-z0-9][a-z0-9._:@-]{7,159}$/i.test(workerId)
        ) {
          throw new HttpError(
            400,
            'INVALID_WORKER_ID',
            'worker_id 必须是 8 到 160 位安全字符串',
          );
        }
        const waitMs = body.wait_ms === undefined ? 0 : Number(body.wait_ms);
        if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 25_000) {
          throw new HttpError(400, 'INVALID_JOB_CLAIM', 'wait_ms 必须是 0 到 25000 之间的整数');
        }
        runtime.touchJob(client, workerId);
        const deadline = Date.now() + waitMs;
        let claim = null;
        do {
          claim = await jobs.claim(capabilityIds, client.id, workerId);
          if (claim || Date.now() >= deadline || request.aborted || response.destroyed) break;
          await delay(Math.min(250, Math.max(1, deadline - Date.now())));
        } while (true);
        if (request.aborted || response.destroyed) return;
        runtime.touchJob(client, workerId, claim?.job ?? null);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          ...(claim ?? { job: null, claim_token: null }),
        });
        return;
      }

      const jobStatusMatch = /^\/v2\/jobs\/([a-z0-9._-]+)$/i.exec(requestUrl.pathname);
      if (request.method === 'GET' && jobStatusMatch) {
        const client = await authenticate(request);
        const job = await jobs.get(jobStatusMatch[1]);
        requireJobReadAccess(client, job);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          job,
        });
        return;
      }

      const jobProgressMatch = /^\/v2\/jobs\/([a-z0-9._-]+)\/progress$/i.exec(requestUrl.pathname);
      if (request.method === 'POST' && jobProgressMatch) {
        const client = await authenticate(request);
        const existing = await jobs.get(jobProgressMatch[1]);
        requirePermission(client, `job:execute:${existing.capability}`);
        assertContentType(request, 'application/json');
        const body = parseJsonBuffer(await readRequestBuffer(request, registry.service.maxBodyBytes));
        const job = await jobs.progress(existing.job_id, client.id, body);
        runtime.touchJob(client, job.worker_id ?? client.id, job);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          job,
        });
        return;
      }

      const jobCompleteMatch = /^\/v2\/jobs\/([a-z0-9._-]+)\/complete$/i.exec(requestUrl.pathname);
      if (request.method === 'POST' && jobCompleteMatch) {
        const client = await authenticate(request);
        const existing = await jobs.get(jobCompleteMatch[1]);
        requirePermission(client, `job:execute:${existing.capability}`);
        assertContentType(request, 'application/json');
        const body = parseJsonBuffer(await readRequestBuffer(request, registry.service.maxBodyBytes));
        const result = await jobs.complete(existing.job_id, client.id, body);
        runtime.touchJob(client, result.job.worker_id ?? client.id, result.job);
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          duplicate: result.duplicate,
          job: result.job,
        });
        return;
      }

      const datasetMatch = /^\/v2\/datasets\/([a-z0-9._-]+)\/ingest$/i.exec(requestUrl.pathname);
      if (request.method === 'POST' && datasetMatch) {
        const client = await authenticate(request);
        const dataset = registry.datasets[datasetMatch[1]];
        if (!dataset) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '数据集未注册');
        const result = await ingestDataset({ request, dataset, client, legacy: false });
        sendJson(response, result.statusCode, { request_id: currentRequestId, ...result.body });
        return;
      }

      const configMatch = /^\/v2\/configs\/([a-z0-9._-]+)$/i.exec(requestUrl.pathname);
      if (configMatch && request.method === 'GET') {
        const client = await authenticate(request);
        const definition = registry.configs[configMatch[1]];
        if (!definition) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '配置资源未注册');
        requirePermission(client, `config:read:${definition.id}`);
        const document = await readCurrent(definition);
        const etag = `"${document.revision}"`;
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
          response.end();
          return;
        }
        sendJson(response, 200, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          config: document,
        }, { ETag: etag });
        return;
      }
      if (configMatch && request.method === 'PUT') {
        const client = await authenticate(request);
        const definition = registry.configs[configMatch[1]];
        if (!definition) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '配置资源未注册');
        requirePermission(client, `config:write:${definition.id}`);
        assertContentType(request, 'application/json');
        const limit = Math.min(registry.service.maxBodyBytes, definition.maxBytes + 64 * 1024);
        const body = parseJsonBuffer(await readRequestBuffer(request, limit));
        const result = await storeQueues[definition.storeId].run(() => publishConfig(definition, body, {
          clientId: client.id,
          via: 'bridge-api',
        }));
        sendJson(response, result.duplicate ? 200 : 201, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          resource_id: definition.id,
          revision: result.document.revision,
          duplicate: result.duplicate,
          config: result.document,
        });
        return;
      }

      const artifactMatch = /^\/v2\/artifacts\/([a-z0-9._-]+)$/i.exec(requestUrl.pathname);
      if (artifactMatch && request.method === 'POST') {
        const client = await authenticate(request);
        const definition = registry.artifactBuckets[artifactMatch[1]];
        if (!definition) throw new HttpError(404, 'RESOURCE_NOT_FOUND', '文件桶未注册');
        requirePermission(client, `artifact:write:${definition.id}`);
        const filename = requestUrl.searchParams.get('filename')
          ?? request.headers['x-local-bridge-filename'];
        const buffer = await readRequestBuffer(request, Math.min(registry.service.maxBodyBytes, definition.maxBytes));
        const expectedSha = request.headers['x-content-sha256'] ?? request.headers['x-local-bridge-sha256'];
        if (expectedSha && expectedSha !== sha256(buffer)) {
          throw new HttpError(400, 'HASH_MISMATCH', '文件 SHA-256 与请求声明不一致');
        }
        let relatedTo = null;
        const relatedHeader = request.headers['x-local-bridge-related-to'];
        if (typeof relatedHeader === 'string' && relatedHeader.length <= 2048) {
          try {
            relatedTo = JSON.parse(relatedHeader);
          } catch {
            throw new HttpError(400, 'INVALID_RELATED_TO', 'X-Local-Bridge-Related-To 不是有效 JSON');
          }
        }
        const result = await storeQueues[definition.storeId].run(() => uploadArtifact(definition, buffer, {
          filename,
          mediaType: request.headers['content-type'],
          clientId: client.id,
          relatedTo: isPlainObject(relatedTo) ? relatedTo : null,
        }));
        sendJson(response, result.duplicate ? 200 : 201, {
          ok: true,
          request_id: currentRequestId,
          protocol_version: PROTOCOL_VERSION,
          artifact: result,
        });
        return;
      }

      throw new HttpError(404, 'NOT_FOUND', '接口不存在');
    })().catch((error) => {
      if (response.headersSent || response.destroyed) return;
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
      if (!(error instanceof HttpError)) {
        console.error(`[${new Date().toISOString()}] 本地自动化桥请求失败`, error);
      }
      sendJson(response, statusCode, {
        ok: false,
        error: {
          code,
          message: error instanceof HttpError ? error.message : '本地自动化桥内部错误',
          request_id: currentRequestId,
        },
      });
    });
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(30_000, REQUEST_TIMEOUT_MS);
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

  return {
    configPath,
    registry,
    auth,
    jobs,
    runtime,
    server,
    async listen() {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolve();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(registry.service.port, registry.service.host);
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

async function runCli() {
  const bridge = await createBridge();
  const address = await bridge.listen();
  console.log(`本地自动化桥 v${BRIDGE_VERSION}`);
  console.log(`监听地址：http://${address.address}:${address.port}`);
  console.log(`注册表：${bridge.configPath}`);
  console.log(`运行状态目录：${bridge.registry.service.stateRoot}`);
  console.log('按 Ctrl+C 停止。');
  const shutdown = async (signal) => {
    console.log(`\n收到 ${signal}，正在停止……`);
    try {
      await bridge.close();
      process.exitCode = 0;
    } catch (error) {
      console.error('停止失败：', error);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

module.exports = {
  BRIDGE_VERSION,
  LEGACY_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  createBridge,
};

if (require.main === module) {
  runCli().catch((error) => {
    console.error('本地自动化桥启动失败：', error.message);
    process.exitCode = 1;
  });
}
