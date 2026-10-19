'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createFbaShipmentsAdapter } = require('./adapters/fba-shipments.cjs');
const { AuthStore } = require('./lib/auth-store.cjs');
const { publishConfig, readCurrent } = require('./lib/config-store.cjs');
const { uploadArtifact } = require('./lib/artifact-store.cjs');
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

const BRIDGE_VERSION = '1.0.0';
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
  throw new Error(`数据集 ${definition.id} 使用了未知 adapter：${definition.adapter}`);
}

async function publishLocalCatalog(registry, configPath) {
  const sharedStore = registry.stores.shared;
  if (!sharedStore) return;
  const guideDir = path.join(sharedStore.rootDir, '_说明');
  const guideTarget = path.join(guideDir, '本地自动化桥-AI接入说明.md');
  const guideSource = path.join(__dirname, 'AI接入说明.md');
  try {
    await writeTextAtomic(guideTarget, await fs.readFile(guideSource, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
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
    purpose: '供本地 AI 和脚本发现已登记资源；浏览器客户端应使用 /v2/capabilities。',
    documentation: path.relative(sharedStore.rootDir, guideTarget).split(path.sep).join('/'),
    module_path: __dirname,
    cli_path: path.join(__dirname, 'bridge-cli.cjs'),
    registry_path: configPath,
    sdk_path: path.join(__dirname, 'sdk', 'bridge-client.js'),
    examples: {
      freight_channels: path.join(__dirname, 'examples', 'freight-channels.example.json'),
      userscript_template: path.join(__dirname, 'examples', 'userscript-template.user.js'),
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
