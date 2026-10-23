'use strict';

/**
 * 领星「产品管理 → 产品列表」数据集适配器。
 *
 * 与 fba-shipments.cjs 的区别：
 *  - 产品库是**全量快照**语义，没有 baseline/delta 之分，每次覆盖 latest；
 *  - 接口字段随领星版本变动较大，所以适配器**只强校验主键与条数**，字段原样落盘，
 *    避免领星加/改字段就把采集链路卡死；
 *  - 变化用 add / remove 的 key 集合差集表示（改价、改名先不展开字段级 diff）。
 *
 * scope 隔离（2026-10-21 按领星 toolkit 规范补）：
 *  - `scope.kind = 'full'` 才覆盖基线 latest.json；
 *  - `scope.kind = 'filtered'` 写到 `scopes/<fingerprint>/latest.json`，**绝不动基线**。
 *    规范原文：筛选条件生成独立 scopeFingerprint，筛选结果绝不能覆盖完整基线。
 *  - 未传 scope 时按 full 处理（向后兼容单店铺/全量调用）。
 */

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  HttpError,
  fileTimestamp,
  isPlainObject,
  sha256,
  toPosixRelative,
  writeJsonAtomic,
} = require('../lib/common.cjs');

const DEFAULT_ID = 'products';
const DEFAULT_NAME = '产品列表';
const DEFAULT_FOLDER = '产品数据';

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

function normalizeText(value, fieldName, maxLength = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new HttpError(
      400,
      'INVALID_PAYLOAD',
      `${fieldName} 必须是长度 1–${maxLength} 的字符串`,
    );
  }
  return value;
}

const SCOPE_DIR_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * 筛选范围。规范要求：筛选条件生成独立 scopeFingerprint，筛选结果绝不能覆盖完整基线。
 * 指纹不合规（可能含路径字符）时用 sha256 前 16 位当目录名，避免路径穿越。
 */
function normalizeScope(raw) {
  if (raw === undefined || raw === null) {
    return Object.freeze({ kind: 'full', fingerprint: 'full', dir: 'full', description: null });
  }
  if (!isPlainObject(raw)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'scope 必须是 JSON 对象');
  }
  if (raw.kind !== 'full' && raw.kind !== 'filtered') {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'scope.kind 必须是 full 或 filtered');
  }
  const fingerprint = typeof raw.fingerprint === 'string' ? raw.fingerprint.trim() : '';
  if (fingerprint.length < 1 || fingerprint.length > 128) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'scope.fingerprint 必须是长度 1–128 的字符串');
  }
  const dir = SCOPE_DIR_PATTERN.test(fingerprint)
    ? fingerprint
    : `fp-${sha256(fingerprint).slice(0, 16)}`;
  return Object.freeze({
    kind: raw.kind,
    fingerprint,
    dir,
    description: isPlainObject(raw.description) ? raw.description : null,
  });
}

function validatePayload(body, receivedAt, payloadSha256, datasetId) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', '请求体必须是 JSON 对象');
  }
  if ((body.schema_version ?? 1) !== 1) {
    throw new HttpError(400, 'UNSUPPORTED_SCHEMA', '目前只支持 schema_version=1');
  }

  const declared = body.dataset ?? body.dataset_id;
  if (declared !== datasetId) {
    throw new HttpError(400, 'UNKNOWN_DATASET', `dataset 不是 ${datasetId}`);
  }

  const accountKey = normalizeText(body.account_key, 'account_key');
  const runId = normalizeText(body.run_id, 'run_id', 128);

  if (!isPlainObject(body.export)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'export 必须是 JSON 对象');
  }
  if (body.export.run_id !== runId) {
    throw new HttpError(400, 'CROSS_FIELD_MISMATCH', 'run_id 与 export.run_id 不一致');
  }
  if (body.export.account_key !== accountKey) {
    throw new HttpError(400, 'CROSS_FIELD_MISMATCH', 'account_key 与 export.account_key 不一致');
  }

  if (!isPlainObject(body.snapshot) || !Array.isArray(body.snapshot.records)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.records 必须是数组');
  }
  const records = body.snapshot.records;
  const recordCount = records.length;

  if (body.snapshot.record_count !== undefined && body.snapshot.record_count !== recordCount) {
    throw new HttpError(
      400,
      'RECORD_COUNT_MISMATCH',
      'snapshot.record_count 与 snapshot.records 实际数量不一致',
    );
  }

  // 接口自报条数必须与抓到的条数一致，否则就是漏页 —— 这是整个链路最重要的一道闸。
  const apiTotal = body.snapshot.api_total;
  if (apiTotal !== undefined && apiTotal !== null) {
    if (!Number.isSafeInteger(apiTotal) || apiTotal < 0) {
      throw new HttpError(400, 'INVALID_PAYLOAD', 'snapshot.api_total 必须是非负整数');
    }
    if (apiTotal !== recordCount) {
      throw new HttpError(
        400,
        'RECORD_COUNT_MISMATCH',
        `接口报告 ${apiTotal} 条，实际收到 ${recordCount} 条（疑似漏页）`,
      );
    }
  }

  const keys = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!isPlainObject(record)) {
      throw new HttpError(400, 'INVALID_PAYLOAD', `snapshot.records[${index}] 不是对象`);
    }
    const key = record._record_key;
    if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
      throw new HttpError(
        400,
        'INVALID_RECORD_KEY',
        `snapshot.records[${index}]._record_key 必须是非空字符串`,
      );
    }
    if (keys.has(key)) {
      throw new HttpError(400, 'DUPLICATE_RECORD_KEY', `存在重复的 _record_key：${key}`);
    }
    keys.add(key);
  }

  const normalizedReceivedAt = normalizeIsoDate(receivedAt, 'received_at');
  const collectedAt = normalizeIsoDate(body.collected_at, 'collected_at', normalizedReceivedAt);
  const completedAt = normalizeIsoDate(body.export.completed_at, 'export.completed_at');
  if (completedAt !== collectedAt) {
    throw new HttpError(400, 'CROSS_FIELD_MISMATCH', 'collected_at 与 export.completed_at 不一致');
  }

  return Object.freeze({
    dataset: datasetId,
    accountKey,
    runId,
    collectedAt,
    receivedAt: normalizedReceivedAt,
    scope: normalizeScope(body.scope ?? (isPlainObject(body.snapshot) ? body.snapshot.scope : undefined)),
    records,
    recordCount,
    apiTotal: apiTotal ?? recordCount,
    source: isPlainObject(body.snapshot.source) ? body.snapshot.source : null,
    exportPayload: body.export,
    payloadSha256,
  });
}

async function readManifest(manifestPath) {
  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (!isPlainObject(manifest) || !isPlainObject(manifest.datasets)) {
      throw new Error('manifest.json 结构无效');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') return { schema_version: 1, updated_at: null, datasets: {} };
    throw new Error(`无法读取现有 manifest.json：${error.message}`);
  }
}

function createProductsAdapter(options) {
  if (!isPlainObject(options) || typeof options.rootDir !== 'string') {
    throw new TypeError('createProductsAdapter 需要 options.rootDir');
  }
  const datasetId = options.id || DEFAULT_ID;
  const name = options.name || DEFAULT_NAME;
  const folder = options.folder || DEFAULT_FOLDER;
  const rootDir = path.resolve(options.rootDir);
  const datasetDir = path.resolve(rootDir, folder);
  const relative = path.relative(rootDir, datasetDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('folder 不能离开 rootDir');
  }

  const snapshotsDir = path.join(datasetDir, 'snapshots');
  const changesDir = path.join(datasetDir, 'changes');
  const latestPath = path.join(datasetDir, 'latest.json');
  const statusPath = path.join(datasetDir, 'status.json');
  const manifestPath = path.join(rootDir, 'manifest.json');
  let persistTail = Promise.resolve();

  async function persistOnce(ingest) {
    if (!isPlainObject(ingest) || ingest.dataset !== datasetId) {
      throw new HttpError(400, 'INVALID_PAYLOAD', `待持久化数据不是 ${datasetId}`);
    }

    await Promise.all([
      fs.mkdir(snapshotsDir, { recursive: true }),
      fs.mkdir(changesDir, { recursive: true }),
    ]);

    const previousManifest = await readManifest(manifestPath);
    const existing = previousManifest.datasets[datasetId];
    const isFull = ingest.scope.kind === 'full';

    if (
      isPlainObject(existing)
      && typeof existing.account_key === 'string'
      && existing.account_key !== ingest.accountKey
    ) {
      throw new HttpError(409, 'ACCOUNT_MISMATCH', `该目录已绑定另一个 ${name} account_key`);
    }

    const existingScopes = isPlainObject(existing) && isPlainObject(existing.scopes)
      ? existing.scopes
      : {};
    const existingScope = isFull ? existing : existingScopes[ingest.scope.fingerprint];

    if (isPlainObject(existingScope) && existingScope.run_id === ingest.runId) {
      if (existingScope.ingest_sha256 === ingest.payloadSha256) {
        return {
          dataset: datasetId,
          account_key: ingest.accountKey,
          scope: ingest.scope,
          run_id: ingest.runId,
          record_count: existingScope.record_count,
          received_at: existingScope.last_success_at,
          ingest_sha256: existingScope.ingest_sha256,
          duplicate: true,
          files: {
            latest: existingScope.latest,
            snapshot: existingScope.snapshot,
            change: existingScope.last_change,
            status: toPosixRelative(rootDir, statusPath),
            manifest: 'manifest.json',
          },
        };
      }
      throw new HttpError(409, 'RUN_ID_CONFLICT', '相同 run_id 已提交过不同内容');
    }

    // 用**同一 scope** 的上一版 latest 算 key 集合差集
    let previousKeys = null;
    if (isPlainObject(existingScope) && typeof existingScope.latest === 'string') {
      try {
        const prev = JSON.parse(
          await fs.readFile(path.join(rootDir, existingScope.latest), 'utf8'),
        );
        if (Array.isArray(prev?.records)) {
          previousKeys = new Set(prev.records.map((r) => r?._record_key).filter(Boolean));
        }
      } catch (_) {
        previousKeys = null;
      }
    }

    const currentKeys = new Set(ingest.records.map((r) => r._record_key));
    const added = previousKeys ? [...currentKeys].filter((k) => !previousKeys.has(k)) : [];
    const removed = previousKeys ? [...previousKeys].filter((k) => !currentKeys.has(k)) : [];

    const receivedDate = new Date(ingest.receivedAt);
    const runSuffix = sha256(`${ingest.accountKey}\n${ingest.runId}`).slice(0, 12);
    const snapshotPath = path.join(snapshotsDir, `${fileTimestamp(receivedDate)}-${runSuffix}.json`);
    const changePath = path.join(changesDir, `${fileTimestamp(receivedDate)}-snapshot-${runSuffix}.json`);

    // 筛选结果写独立 scope 目录，绝不覆盖基线 latest.json
    const targetLatestPath = isFull
      ? path.join(datasetDir, 'latest.json')
      : path.join(datasetDir, 'scopes', ingest.scope.dir, 'latest.json');
    await fs.mkdir(path.dirname(targetLatestPath), { recursive: true });

    const latestDocument = {
      schema_version: 1,
      dataset: datasetId,
      dataset_name: name,
      semantics: 'full_snapshot',
      account_key: ingest.accountKey,
      scope: ingest.scope,
      updated_at: ingest.receivedAt,
      collected_at: ingest.collectedAt,
      run_id: ingest.runId,
      record_count: ingest.recordCount,
      api_total: ingest.apiTotal,
      source: ingest.source,
      records: ingest.records,
    };

    const changeDocument = {
      schema_version: 1,
      dataset: datasetId,
      dataset_name: name,
      account_key: ingest.accountKey,
      run_id: ingest.runId,
      collected_at: ingest.collectedAt,
      received_at: ingest.receivedAt,
      export: ingest.exportPayload,
      diff: {
        baseline: previousKeys === null,
        added_count: added.length,
        removed_count: removed.length,
        added_keys: added.slice(0, 2000),
        removed_keys: removed.slice(0, 2000),
      },
    };

    const snapshotWrite = await writeJsonAtomic(snapshotPath, latestDocument);
    const changeWrite = await writeJsonAtomic(changePath, changeDocument);
    await writeJsonAtomic(targetLatestPath, latestDocument);

    const statusDocument = {
      schema_version: 1,
      dataset: datasetId,
      account_key: ingest.accountKey,
      scope: ingest.scope,
      state: 'success',
      last_success_at: ingest.receivedAt,
      collected_at: ingest.collectedAt,
      run_id: ingest.runId,
      record_count: ingest.recordCount,
      api_total: ingest.apiTotal,
      added_count: added.length,
      removed_count: removed.length,
      latest_file: toPosixRelative(rootDir, targetLatestPath),
      latest_sha256: snapshotWrite.sha256,
      snapshot_file: toPosixRelative(rootDir, snapshotPath),
      snapshot_sha256: snapshotWrite.sha256,
      change_file: toPosixRelative(rootDir, changePath),
      change_sha256: changeWrite.sha256,
      last_error: null,
    };
    await writeJsonAtomic(statusPath, statusDocument);

    const scopeEntry = {
      fingerprint: ingest.scope.fingerprint,
      kind: ingest.scope.kind,
      description: ingest.scope.description,
      latest: toPosixRelative(rootDir, targetLatestPath),
      snapshot: toPosixRelative(rootDir, snapshotPath),
      last_change: toPosixRelative(rootDir, changePath),
      record_count: ingest.recordCount,
      api_total: ingest.apiTotal,
      last_success_at: ingest.receivedAt,
      collected_at: ingest.collectedAt,
      run_id: ingest.runId,
      snapshot_sha256: snapshotWrite.sha256,
      ingest_sha256: ingest.payloadSha256,
      state: 'success',
    };

    const baseEntry = isPlainObject(existing) ? existing : {};
    const nextEntry = isFull
      ? {
        ...baseEntry,
        name,
        account_key: ingest.accountKey,
        ...scopeEntry,
        status: toPosixRelative(rootDir, statusPath),
        changes: toPosixRelative(rootDir, changesDir),
        export_type: 'full_snapshot',
        scopes: existingScopes,
        schema_version: 1,
      }
      : {
        ...baseEntry,
        name,
        account_key: ingest.accountKey,
        scopes: { ...existingScopes, [ingest.scope.fingerprint]: scopeEntry },
        schema_version: 1,
      };

    const manifestDocument = {
      ...previousManifest,
      schema_version: 1,
      updated_at: ingest.receivedAt,
      datasets: {
        ...previousManifest.datasets,
        [datasetId]: nextEntry,
      },
    };
    await writeJsonAtomic(manifestPath, manifestDocument);

    return {
      dataset: datasetId,
      account_key: ingest.accountKey,
      scope: ingest.scope,
      run_id: ingest.runId,
      record_count: ingest.recordCount,
      api_total: ingest.apiTotal,
      added_count: added.length,
      removed_count: removed.length,
      received_at: ingest.receivedAt,
      ingest_sha256: ingest.payloadSha256,
      duplicate: false,
      files: {
        latest: toPosixRelative(rootDir, targetLatestPath),
        snapshot: toPosixRelative(rootDir, snapshotPath),
        change: toPosixRelative(rootDir, changePath),
        status: toPosixRelative(rootDir, statusPath),
        manifest: toPosixRelative(rootDir, manifestPath),
      },
    };
  }

  function persist(ingest) {
    const result = persistTail.then(() => persistOnce(ingest), () => persistOnce(ingest));
    persistTail = result.catch(() => undefined);
    return result;
  }

  return Object.freeze({
    id: datasetId,
    name,
    rootDir,
    folder,
    validate({ body, receivedAt, payloadSha256 }) {
      return validatePayload(body, receivedAt, payloadSha256, datasetId);
    },
    persist,
  });
}

module.exports = { createProductsAdapter };
