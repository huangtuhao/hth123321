'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const BRIDGE_VERSION = '0.3.0';
const BRIDGE_PROTOCOL_VERSION = 1;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 32145;
const DEFAULT_ROOT = 'C:\\数据\\领星';
const DEFAULT_MAX_BODY_BYTES = 128 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120_000;

const DATASETS = Object.freeze({
  fba_shipments: Object.freeze({
    id: 'fba_shipments',
    name: 'FBA货件',
    folder: 'FBA数据',
  }),
});

const PAIR_CLIENT_ID = 'lingxing-tampermonkey-v1';

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function parsePositiveInteger(value, fallback, name, options = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

function buildConfig(overrides = {}) {
  const rootDir = path.resolve(
    String(overrides.rootDir ?? process.env.LINGXING_BRIDGE_ROOT ?? DEFAULT_ROOT),
  );
  const host = String(overrides.host ?? DEFAULT_HOST);
  if (host !== DEFAULT_HOST) {
    throw new Error('出于安全原因，本地桥只允许绑定到 127.0.0.1');
  }

  return Object.freeze({
    host,
    port: parsePositiveInteger(
      overrides.port ?? process.env.LINGXING_BRIDGE_PORT,
      DEFAULT_PORT,
      '端口',
      { minimum: 0, maximum: 65535 },
    ),
    rootDir,
    maxBodyBytes: parsePositiveInteger(
      overrides.maxBodyBytes ?? process.env.LINGXING_BRIDGE_MAX_BYTES,
      DEFAULT_MAX_BODY_BYTES,
      '最大请求体字节数',
      { minimum: 1024, maximum: 1024 * 1024 * 1024 },
    ),
    token: overrides.token ?? process.env.LINGXING_BRIDGE_TOKEN ?? null,
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIsoDate(value, fieldName, fallback = null) {
  if ((value === undefined || value === null || value === '') && fallback !== null) {
    return fallback;
  }
  if (typeof value !== 'string' || value.length > 64) {
    throw new HttpError(400, 'INVALID_PAYLOAD', `${fieldName} 必须是 ISO 日期字符串`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'INVALID_PAYLOAD', `${fieldName} 不是有效日期`);
  }
  return parsed.toISOString();
}

function normalizeOptionalText(value, fieldName, fallback, maxLength = 256) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new HttpError(400, 'INVALID_PAYLOAD', `${fieldName} 必须是长度不超过 ${maxLength} 的字符串`);
  }
  return value;
}

function detectExportType(exportPayload) {
  const candidate = exportPayload.export_type
    ?? exportPayload.type
    ?? exportPayload.kind
    ?? exportPayload.mode;
  if (candidate !== 'baseline' && candidate !== 'delta') {
    throw new HttpError(
      400,
      'INVALID_PAYLOAD',
      'export.export_type 必须是 baseline 或 delta',
    );
  }
  return candidate;
}

function validateIngestPayload(body, receivedAt, payloadSha256 = null) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', '请求体必须是 JSON 对象');
  }

  const schemaVersion = body.schema_version ?? 1;
  if (schemaVersion !== 1) {
    throw new HttpError(400, 'UNSUPPORTED_SCHEMA', '目前只支持 schema_version=1');
  }

  const datasetId = body.dataset ?? body.dataset_id;
  if (typeof datasetId !== 'string' || !DATASETS[datasetId]) {
    throw new HttpError(400, 'UNKNOWN_DATASET', 'dataset 不在本地桥白名单中');
  }
  const accountKey = normalizeOptionalText(
    body.account_key,
    'account_key',
    null,
    256,
  );
  if (accountKey === null) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'account_key 不能为空');
  }
  if (!isPlainObject(body.export)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'export 必须是 JSON 对象');
  }
  if (!isPlainObject(body.snapshot) || !Array.isArray(body.snapshot.records)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.records 必须是数组');
  }
  const snapshotSemantics = body.snapshot.semantics ?? 'confirmed_next_baseline';
  if (snapshotSemantics !== 'confirmed_next_baseline') {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.semantics 不受支持');
  }

  const recordCount = body.snapshot.records.length;
  if (
    body.snapshot.record_count !== undefined
    && body.snapshot.record_count !== recordCount
  ) {
    throw new HttpError(
      400,
      'RECORD_COUNT_MISMATCH',
      'snapshot.record_count 与 snapshot.records 实际数量不一致',
    );
  }

  const recordKeys = new Set();
  for (let index = 0; index < body.snapshot.records.length; index += 1) {
    const record = body.snapshot.records[index];
    if (
      !isPlainObject(record)
      || typeof record._record_key !== 'string'
      || record._record_key.length === 0
      || record._record_key.length > 512
    ) {
      throw new HttpError(
        400,
        'INVALID_RECORD_KEY',
        `snapshot.records[${index}]._record_key 必须是非空字符串`,
      );
    }
    if (recordKeys.has(record._record_key)) {
      throw new HttpError(
        400,
        'DUPLICATE_RECORD_KEY',
        `snapshot.records 中存在重复的 _record_key：${record._record_key}`,
      );
    }
    const hasId = record.id !== undefined && record.id !== null && record.id !== '';
    const expectedKey = hasId
      ? `id:${record.id}`
      : record.shipment_id !== undefined && record.shipment_id !== null && record.shipment_id !== ''
        ? `shipment:${record.shipment_id}`
        : null;
    if (expectedKey !== record._record_key) {
      throw new HttpError(
        400,
        'INVALID_RECORD_KEY',
        `snapshot.records[${index}]._record_key 与记录主键不一致`,
      );
    }
    recordKeys.add(record._record_key);
  }

  const sourceRecordCount = body.snapshot.source_record_count ?? recordCount;
  if (!Number.isSafeInteger(sourceRecordCount) || sourceRecordCount < 0) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.source_record_count 必须是非负整数');
  }
  const pendingMissing = body.snapshot.pending_missing ?? 0;
  if (!Number.isSafeInteger(pendingMissing) || pendingMissing < 0) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.pending_missing 必须是非负整数');
  }
  if (sourceRecordCount + pendingMissing !== recordCount) {
    throw new HttpError(
      400,
      'RECORD_COUNT_MISMATCH',
      'snapshot.record_count 必须等于 source_record_count + pending_missing',
    );
  }

  const exportType = detectExportType(body.export);
  const runId = normalizeOptionalText(body.run_id, 'run_id', null, 128);
  if (runId === null) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'run_id 不能为空');
  }
  const exportRunId = normalizeOptionalText(body.export.run_id, 'export.run_id', null, 128);
  if (exportRunId !== runId) {
    throw new HttpError(400, 'CROSS_FIELD_MISMATCH', 'run_id 与 export.run_id 不一致');
  }
  const exportAccountKey = normalizeOptionalText(
    body.export.account_key,
    'export.account_key',
    null,
    256,
  );
  if (exportAccountKey !== accountKey) {
    throw new HttpError(
      400,
      'CROSS_FIELD_MISMATCH',
      'account_key 与 export.account_key 不一致',
    );
  }
  const collectedAt = normalizeIsoDate(body.collected_at, 'collected_at', receivedAt);
  const exportCompletedAt = normalizeIsoDate(body.export.completed_at, 'export.completed_at');
  if (exportCompletedAt !== collectedAt) {
    throw new HttpError(
      400,
      'CROSS_FIELD_MISMATCH',
      'collected_at 与 export.completed_at 不一致',
    );
  }
  if (!isPlainObject(body.export.summary)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'export.summary 必须是 JSON 对象');
  }
  const summaryRecordCount = exportType === 'baseline'
    ? body.export.summary.baseline_records
    : body.export.summary.baseline_records_after;
  if (!Number.isSafeInteger(summaryRecordCount) || summaryRecordCount !== recordCount) {
    throw new HttpError(
      400,
      'CROSS_FIELD_MISMATCH',
      'export.summary 的基线记录数与 snapshot.record_count 不一致',
    );
  }
  if (body.export.summary.pending_missing !== pendingMissing) {
    throw new HttpError(
      400,
      'CROSS_FIELD_MISMATCH',
      'export.summary.pending_missing 与 snapshot.pending_missing 不一致',
    );
  }
  if (
    !isPlainObject(body.export.source)
    || !Number.isSafeInteger(body.export.source.unique_total)
    || body.export.source.unique_total !== sourceRecordCount
  ) {
    throw new HttpError(
      400,
      'CROSS_FIELD_MISMATCH',
      'export.source.unique_total 与 snapshot.source_record_count 不一致',
    );
  }

  return Object.freeze({
    schemaVersion,
    dataset: datasetId,
    accountKey,
    exportType,
    runId,
    collectedAt,
    receivedAt,
    exportPayload: body.export,
    records: body.snapshot.records,
    recordCount,
    sourceRecordCount,
    pendingMissing,
    snapshotSemantics,
    source: isPlainObject(body.snapshot.source) ? body.snapshot.source : null,
    payloadSha256,
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeTokenEquals(actual, expected) {
  const actualHash = crypto.createHash('sha256').update(actual ?? '').digest();
  const expectedHash = crypto.createHash('sha256').update(expected ?? '').digest();
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function extractToken(request) {
  const customHeader = request.headers['x-lingxing-bridge-token'];
  if (typeof customHeader === 'string' && customHeader) return customHeader;

  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length);
  }
  return '';
}

async function ensureToken(config) {
  const configDir = path.join(config.rootDir, '_config');
  const tokenFile = path.join(configDir, 'bridge-token.txt');
  await fsp.mkdir(configDir, { recursive: true });

  if (config.token !== null) {
    const configuredToken = String(config.token).trim();
    if (configuredToken.length < 24) {
      throw new Error('LINGXING_BRIDGE_TOKEN 至少需要 24 个字符');
    }
    return { token: configuredToken, tokenFile, source: 'environment' };
  }

  try {
    const existingToken = (await fsp.readFile(tokenFile, 'utf8')).trim();
    if (existingToken.length < 24) {
      throw new Error(`${tokenFile} 中的令牌无效，请删除该文件后重新启动`);
    }
    return { token: existingToken, tokenFile, source: 'file' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const generatedToken = crypto.randomBytes(32).toString('base64url');
  try {
    await fsp.writeFile(tokenFile, `${generatedToken}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    return { token: generatedToken, tokenFile, source: 'generated' };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existingToken = (await fsp.readFile(tokenFile, 'utf8')).trim();
    if (existingToken.length < 24) {
      throw new Error(`${tokenFile} 中的令牌无效`);
    }
    return { token: existingToken, tokenFile, source: 'file' };
  }
}

async function readRequestBody(request, maxBodyBytes) {
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding !== 'identity') {
    throw new HttpError(415, 'UNSUPPORTED_ENCODING', '不接受压缩请求体');
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制');
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytesRead = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    request.on('data', (chunk) => {
      if (settled) return;
      bytesRead += chunk.length;
      if (bytesRead > maxBodyBytes) {
        fail(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('aborted', () => fail(new HttpError(400, 'REQUEST_ABORTED', '请求被中断')));
    request.on('error', fail);
  });
}

function serializeJson(value) {
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch (error) {
    throw new HttpError(400, 'UNSERIALIZABLE_PAYLOAD', `JSON 无法序列化：${error.message}`);
  }
}

async function writeTextAtomic(targetPath, text) {
  const targetDir = path.dirname(targetPath);
  await fsp.mkdir(targetDir, { recursive: true });

  const temporaryPath = path.join(
    targetDir,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let handle;
  try {
    handle = await fsp.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fsp.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return {
    bytes: Buffer.byteLength(text),
    sha256: sha256(text),
  };
}

async function writeJsonAtomic(targetPath, value) {
  return writeTextAtomic(targetPath, serializeJson(value));
}

async function readManifest(manifestPath) {
  try {
    const content = await fsp.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    if (!isPlainObject(manifest) || !isPlainObject(manifest.datasets)) {
      throw new Error('manifest.json 结构无效');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schema_version: 1,
        bridge_version: BRIDGE_VERSION,
        updated_at: null,
        datasets: {},
      };
    }
    throw new Error(`无法读取现有 manifest.json：${error.message}`);
  }
}

function fileTimestamp(date) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

async function persistIngest(config, ingest) {
  const datasetConfig = DATASETS[ingest.dataset];
  const datasetDir = path.join(config.rootDir, datasetConfig.folder);
  const changesDir = path.join(datasetDir, 'changes');
  const snapshotsDir = path.join(datasetDir, 'snapshots');
  const latestPath = path.join(datasetDir, 'latest.json');
  const statusPath = path.join(datasetDir, 'status.json');
  const manifestPath = path.join(config.rootDir, 'manifest.json');

  await Promise.all([
    fsp.mkdir(changesDir, { recursive: true }),
    fsp.mkdir(snapshotsDir, { recursive: true }),
  ]);

  const previousManifest = await readManifest(manifestPath);
  const existingDataset = previousManifest.datasets[ingest.dataset];
  if (
    isPlainObject(existingDataset)
    && typeof existingDataset.account_key === 'string'
    && existingDataset.account_key !== ingest.accountKey
  ) {
    throw new HttpError(
      409,
      'ACCOUNT_MISMATCH',
      `该目录已经绑定到另一个 ${datasetConfig.name} account_key；请使用独立数据目录`,
    );
  }

  if (isPlainObject(existingDataset) && existingDataset.run_id === ingest.runId) {
    if (
      typeof existingDataset.ingest_sha256 === 'string'
      && existingDataset.ingest_sha256 === ingest.payloadSha256
    ) {
      return {
        dataset: ingest.dataset,
        account_key: ingest.accountKey,
        export_type: ingest.exportType,
        run_id: ingest.runId,
        record_count: existingDataset.record_count,
        source_record_count: existingDataset.source_record_count,
        pending_missing: existingDataset.pending_missing,
        received_at: existingDataset.last_success_at,
        ingest_sha256: existingDataset.ingest_sha256,
        duplicate: true,
        files: {
          latest: existingDataset.latest,
          snapshot: existingDataset.snapshot,
          change: existingDataset.last_change,
          status: existingDataset.status,
          manifest: 'manifest.json',
        },
      };
    }
    throw new HttpError(
      409,
      'RUN_ID_CONFLICT',
      '相同 run_id 已经提交过不同内容，已拒绝覆盖',
    );
  }

  if (isPlainObject(existingDataset)) {
    const previousCollectedAt = Date.parse(existingDataset.collected_at || '');
    const currentCollectedAt = Date.parse(ingest.collectedAt);
    if (
      Number.isFinite(previousCollectedAt)
      && Number.isFinite(currentCollectedAt)
      && currentCollectedAt < previousCollectedAt
    ) {
      throw new HttpError(409, 'STALE_RUN', '本次数据早于已提交数据，已拒绝回滚');
    }

    if (ingest.exportType === 'delta') {
      const previousRunId = ingest.exportPayload.previous_run_id ?? null;
      if (previousRunId !== existingDataset.run_id) {
        throw new HttpError(
          409,
          'LINEAGE_MISMATCH',
          '增量 previous_run_id 与本地桥当前版本不一致，请重新建立完整基线',
        );
      }
    }
  }

  const receivedDate = new Date(ingest.receivedAt);
  const runSuffix = sha256(`${ingest.accountKey}\n${ingest.runId}`).slice(0, 12);
  const changeFilename = `${fileTimestamp(receivedDate)}-${ingest.exportType}-${runSuffix}.json`;
  const changePath = path.join(changesDir, changeFilename);
  const snapshotFilename = `${fileTimestamp(receivedDate)}-${runSuffix}.json`;
  const snapshotPath = path.join(snapshotsDir, snapshotFilename);

  const changeDocument = {
    schema_version: 1,
    dataset: ingest.dataset,
    dataset_name: datasetConfig.name,
    account_key: ingest.accountKey,
    export_type: ingest.exportType,
    run_id: ingest.runId,
    collected_at: ingest.collectedAt,
    received_at: ingest.receivedAt,
    export: ingest.exportPayload,
  };

  const latestDocument = {
    schema_version: 1,
    dataset: ingest.dataset,
    dataset_name: datasetConfig.name,
    semantics: ingest.snapshotSemantics,
    account_key: ingest.accountKey,
    updated_at: ingest.receivedAt,
    collected_at: ingest.collectedAt,
    run_id: ingest.runId,
    record_count: ingest.recordCount,
    source_record_count: ingest.sourceRecordCount,
    pending_missing: ingest.pendingMissing,
    source: ingest.source,
    records: ingest.records,
  };

  // manifest.json 最后写入，作为一批文件已经完整提交的标志。
  const changeWrite = await writeJsonAtomic(changePath, changeDocument);
  const snapshotWrite = await writeJsonAtomic(snapshotPath, latestDocument);
  const latestWrite = await writeJsonAtomic(latestPath, latestDocument);

  const statusDocument = {
    schema_version: 1,
    dataset: ingest.dataset,
    account_key: ingest.accountKey,
    state: 'success',
    last_success_at: ingest.receivedAt,
    collected_at: ingest.collectedAt,
    run_id: ingest.runId,
    export_type: ingest.exportType,
    record_count: ingest.recordCount,
    source_record_count: ingest.sourceRecordCount,
    pending_missing: ingest.pendingMissing,
    latest_sha256: latestWrite.sha256,
    snapshot_file: toPosixRelative(config.rootDir, snapshotPath),
    snapshot_sha256: snapshotWrite.sha256,
    change_file: toPosixRelative(config.rootDir, changePath),
    change_sha256: changeWrite.sha256,
    last_error: null,
  };
  await writeJsonAtomic(statusPath, statusDocument);

  const datasets = {};
  for (const datasetId of Object.keys(DATASETS)) {
    if (isPlainObject(previousManifest.datasets[datasetId])) {
      datasets[datasetId] = previousManifest.datasets[datasetId];
    }
  }
  datasets[ingest.dataset] = {
    name: datasetConfig.name,
    account_key: ingest.accountKey,
    latest: toPosixRelative(config.rootDir, latestPath),
    snapshot: toPosixRelative(config.rootDir, snapshotPath),
    status: toPosixRelative(config.rootDir, statusPath),
    changes: toPosixRelative(config.rootDir, changesDir),
    last_change: toPosixRelative(config.rootDir, changePath),
    record_count: ingest.recordCount,
    source_record_count: ingest.sourceRecordCount,
    pending_missing: ingest.pendingMissing,
    last_success_at: ingest.receivedAt,
    collected_at: ingest.collectedAt,
    run_id: ingest.runId,
    export_type: ingest.exportType,
    latest_sha256: latestWrite.sha256,
    snapshot_sha256: snapshotWrite.sha256,
    ingest_sha256: ingest.payloadSha256,
    state: 'success',
    schema_version: 1,
  };

  const manifestDocument = {
    schema_version: 1,
    bridge_version: BRIDGE_VERSION,
    updated_at: ingest.receivedAt,
    datasets,
  };
  await writeJsonAtomic(manifestPath, manifestDocument);

  return {
    dataset: ingest.dataset,
    account_key: ingest.accountKey,
    export_type: ingest.exportType,
    run_id: ingest.runId,
    record_count: ingest.recordCount,
    source_record_count: ingest.sourceRecordCount,
    pending_missing: ingest.pendingMissing,
    received_at: ingest.receivedAt,
    ingest_sha256: ingest.payloadSha256,
    duplicate: false,
    files: {
      latest: toPosixRelative(config.rootDir, latestPath),
      snapshot: toPosixRelative(config.rootDir, snapshotPath),
      change: toPosixRelative(config.rootDir, changePath),
      status: toPosixRelative(config.rootDir, statusPath),
      manifest: toPosixRelative(config.rootDir, manifestPath),
    },
  };
}

function sendJson(response, statusCode, body) {
  const text = serializeJson(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(text);
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function createBridge(overrides = {}) {
  const config = buildConfig(overrides);
  await fsp.mkdir(config.rootDir, { recursive: true });
  const auth = await ensureToken(config);
  const ingestQueue = new SerialQueue();
  const startedAt = new Date();

  const server = http.createServer((request, response) => {
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error('请求超时'));
    });

    void (async () => {
      if (!isLoopbackRequest(request)) {
        throw new HttpError(403, 'LOOPBACK_ONLY', '只接受本机回环连接');
      }

      const requestUrl = new URL(request.url, `http://${config.host}:${config.port}`);

      if (request.method === 'OPTIONS') {
        throw new HttpError(403, 'CORS_DISABLED', '本地桥不接受网页跨域调用');
      }

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'lingxing-local-bridge',
          version: BRIDGE_VERSION,
          protocol_version: BRIDGE_PROTOCOL_VERSION,
          writable: true,
          host: config.host,
          data_root: config.rootDir,
          datasets: DATASETS,
          token_required: true,
          started_at: startedAt.toISOString(),
          uptime_seconds: Math.floor(process.uptime()),
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/v1/pair') {
        if (request.headers['x-lingxing-bridge-client'] !== PAIR_CLIENT_ID) {
          throw new HttpError(403, 'PAIRING_DENIED', '配对客户端标识不正确');
        }
        sendJson(response, 200, {
          ok: true,
          service: 'lingxing-local-bridge',
          protocol_version: BRIDGE_PROTOCOL_VERSION,
          token: auth.token,
        });
        return;
      }

      if (request.method !== 'POST' || requestUrl.pathname !== '/v1/ingest') {
        throw new HttpError(404, 'NOT_FOUND', '接口不存在');
      }

      if (!safeTokenEquals(extractToken(request), auth.token)) {
        throw new HttpError(401, 'UNAUTHORIZED', '本地桥令牌不正确');
      }
      const contentType = request.headers['content-type'] ?? '';
      if (!String(contentType).toLowerCase().startsWith('application/json')) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type 必须是 application/json');
      }

      const rawBody = await readRequestBody(request, config.maxBodyBytes);
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON');
      }

      const receivedAt = new Date().toISOString();
      const ingest = validateIngestPayload(body, receivedAt, sha256(rawBody));
      const result = await ingestQueue.run(() => persistIngest(config, ingest));
      sendJson(response, result.duplicate ? 200 : 201, {
        ok: true,
        committed: true,
        protocol_version: BRIDGE_PROTOCOL_VERSION,
        dataset_id: result.dataset,
        data_root: config.rootDir,
        dataset_path: path.join(config.rootDir, DATASETS[result.dataset].folder),
        ...result,
      });
    })().catch((error) => {
      if (response.headersSent || response.destroyed) return;
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
      if (!(error instanceof HttpError)) {
        console.error(`[${new Date().toISOString()}] 本地桥写入失败`, error);
      }
      sendJson(response, statusCode, {
        ok: false,
        error: {
          code,
          message: error instanceof HttpError ? error.message : '本地桥内部错误',
        },
      });
    });
  });

  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = Math.min(30_000, REQUEST_TIMEOUT_MS);
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

  return {
    config,
    auth: Object.freeze({ tokenFile: auth.tokenFile, source: auth.source }),
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
        server.listen(config.port, config.host);
      });
      return server.address();
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function runCli() {
  const bridge = await createBridge();
  const address = await bridge.listen();
  console.log(`领星本地数据桥 v${BRIDGE_VERSION}`);
  console.log(`监听地址：http://${address.address}:${address.port}`);
  console.log(`数据目录：${bridge.config.rootDir}`);
  console.log(`令牌文件：${bridge.auth.tokenFile}`);
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
  BRIDGE_PROTOCOL_VERSION,
  DATASETS,
  createBridge,
  validateIngestPayload,
};

if (require.main === module) {
  runCli().catch((error) => {
    console.error('领星本地数据桥启动失败：', error.message);
    process.exitCode = 1;
  });
}
