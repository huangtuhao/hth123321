'use strict';

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

const DATASET_ID = 'fba_shipments';
const DEFAULT_NAME = 'FBA货件';
const DEFAULT_FOLDER = 'FBA数据';

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
    throw new HttpError(
      400,
      'INVALID_PAYLOAD',
      `${fieldName} 必须是长度不超过 ${maxLength} 的字符串`,
    );
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

function validatePayload(body, receivedAt, payloadSha256) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'INVALID_PAYLOAD', '请求体必须是 JSON 对象');
  }

  const schemaVersion = body.schema_version ?? 1;
  if (schemaVersion !== 1) {
    throw new HttpError(400, 'UNSUPPORTED_SCHEMA', '目前只支持 schema_version=1');
  }

  const datasetId = body.dataset ?? body.dataset_id;
  if (datasetId !== DATASET_ID) {
    throw new HttpError(400, 'UNKNOWN_DATASET', 'dataset 不是 fba_shipments');
  }

  const accountKey = normalizeOptionalText(body.account_key, 'account_key', null, 256);
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

  const records = body.snapshot.records;
  const recordCount = records.length;
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
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
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
    const hasShipmentId = record.shipment_id !== undefined
      && record.shipment_id !== null
      && record.shipment_id !== '';
    const expectedKey = hasId
      ? `id:${record.id}`
      : hasShipmentId
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
    throw new HttpError(
      400,
      'INVALID_PAYLOAD',
      'snapshot.source_record_count 必须是非负整数',
    );
  }
  const pendingMissing = body.snapshot.pending_missing ?? 0;
  if (!Number.isSafeInteger(pendingMissing) || pendingMissing < 0) {
    throw new HttpError(
      400,
      'INVALID_PAYLOAD',
      'snapshot.pending_missing 必须是非负整数',
    );
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

  const normalizedReceivedAt = normalizeIsoDate(receivedAt, 'received_at');
  const collectedAt = normalizeIsoDate(body.collected_at, 'collected_at', normalizedReceivedAt);
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
    dataset: DATASET_ID,
    accountKey,
    exportType,
    runId,
    collectedAt,
    receivedAt: normalizedReceivedAt,
    exportPayload: body.export,
    records,
    recordCount,
    sourceRecordCount,
    pendingMissing,
    snapshotSemantics,
    source: isPlainObject(body.snapshot.source) ? body.snapshot.source : null,
    payloadSha256,
  });
}

async function readManifest(manifestPath) {
  try {
    const content = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    if (!isPlainObject(manifest) || !isPlainObject(manifest.datasets)) {
      throw new Error('manifest.json 结构无效');
    }
    return manifest;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schema_version: 1,
        updated_at: null,
        datasets: {},
      };
    }
    throw new Error(`无法读取现有 manifest.json：${error.message}`);
  }
}

function normalizeFactoryOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('createFbaShipmentsAdapter 需要 options 对象');
  }
  if (typeof options.rootDir !== 'string' || options.rootDir.length === 0) {
    throw new TypeError('rootDir 必须是非空字符串');
  }
  const rootDir = path.resolve(options.rootDir);
  const folder = options.folder ?? DEFAULT_FOLDER;
  if (typeof folder !== 'string' || folder.length === 0 || path.isAbsolute(folder)) {
    throw new TypeError('folder 必须是非空相对路径');
  }
  const datasetDir = path.resolve(rootDir, folder);
  const relative = path.relative(rootDir, datasetDir);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('folder 不能离开 rootDir');
  }
  const name = options.name ?? DEFAULT_NAME;
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
    throw new TypeError('name 必须是长度 1–128 的字符串');
  }
  const bridgeVersion = typeof options.bridgeVersion === 'string' && options.bridgeVersion
    ? options.bridgeVersion
    : null;
  return { rootDir, folder, datasetDir, name, bridgeVersion };
}

function createFbaShipmentsAdapter(options) {
  const {
    rootDir, folder, datasetDir, name, bridgeVersion,
  } = normalizeFactoryOptions(options);
  const changesDir = path.join(datasetDir, 'changes');
  const snapshotsDir = path.join(datasetDir, 'snapshots');
  const latestPath = path.join(datasetDir, 'latest.json');
  const statusPath = path.join(datasetDir, 'status.json');
  const manifestPath = path.join(rootDir, 'manifest.json');
  let persistTail = Promise.resolve();

  async function persistOnce(ingest) {
    if (!isPlainObject(ingest) || ingest.dataset !== DATASET_ID) {
      throw new HttpError(400, 'INVALID_PAYLOAD', '待持久化数据不是 fba_shipments');
    }

    await Promise.all([
      fs.mkdir(changesDir, { recursive: true }),
      fs.mkdir(snapshotsDir, { recursive: true }),
    ]);

    const previousManifest = await readManifest(manifestPath);
    const existingDataset = previousManifest.datasets[DATASET_ID];

    if (
      isPlainObject(existingDataset)
      && typeof existingDataset.account_key === 'string'
      && existingDataset.account_key !== ingest.accountKey
    ) {
      throw new HttpError(
        409,
        'ACCOUNT_MISMATCH',
        `该目录已经绑定到另一个 ${name} account_key；请使用独立数据目录`,
      );
    }

    if (isPlainObject(existingDataset) && existingDataset.run_id === ingest.runId) {
      if (
        typeof existingDataset.ingest_sha256 === 'string'
        && existingDataset.ingest_sha256 === ingest.payloadSha256
      ) {
        return {
          dataset: DATASET_ID,
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
    if (Number.isNaN(receivedDate.getTime())) {
      throw new HttpError(400, 'INVALID_PAYLOAD', 'receivedAt 不是有效日期');
    }
    const runSuffix = sha256(`${ingest.accountKey}\n${ingest.runId}`).slice(0, 12);
    const changeFilename = `${fileTimestamp(receivedDate)}-${ingest.exportType}-${runSuffix}.json`;
    const changePath = path.join(changesDir, changeFilename);
    const snapshotFilename = `${fileTimestamp(receivedDate)}-${runSuffix}.json`;
    const snapshotPath = path.join(snapshotsDir, snapshotFilename);

    const changeDocument = {
      schema_version: 1,
      dataset: DATASET_ID,
      dataset_name: name,
      account_key: ingest.accountKey,
      export_type: ingest.exportType,
      run_id: ingest.runId,
      collected_at: ingest.collectedAt,
      received_at: ingest.receivedAt,
      export: ingest.exportPayload,
    };

    const latestDocument = {
      schema_version: 1,
      dataset: DATASET_ID,
      dataset_name: name,
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

    // manifest.json 最后写入，它是这一批文件已经完整提交的标志。
    const changeWrite = await writeJsonAtomic(changePath, changeDocument);
    const snapshotWrite = await writeJsonAtomic(snapshotPath, latestDocument);
    const latestWrite = await writeJsonAtomic(latestPath, latestDocument);

    const statusDocument = {
      schema_version: 1,
      dataset: DATASET_ID,
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
      snapshot_file: toPosixRelative(rootDir, snapshotPath),
      snapshot_sha256: snapshotWrite.sha256,
      change_file: toPosixRelative(rootDir, changePath),
      change_sha256: changeWrite.sha256,
      last_error: null,
    };
    await writeJsonAtomic(statusPath, statusDocument);

    // 保留其他 adapter 写入的 dataset 以及未知的 manifest 顶层字段。
    const datasets = {
      ...previousManifest.datasets,
      [DATASET_ID]: {
        name,
        account_key: ingest.accountKey,
        latest: toPosixRelative(rootDir, latestPath),
        snapshot: toPosixRelative(rootDir, snapshotPath),
        status: toPosixRelative(rootDir, statusPath),
        changes: toPosixRelative(rootDir, changesDir),
        last_change: toPosixRelative(rootDir, changePath),
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
      },
    };
    const manifestDocument = {
      ...previousManifest,
      schema_version: 1,
      ...(bridgeVersion ? { bridge_version: bridgeVersion } : {}),
      updated_at: ingest.receivedAt,
      datasets,
    };
    await writeJsonAtomic(manifestPath, manifestDocument);

    return {
      dataset: DATASET_ID,
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
        latest: toPosixRelative(rootDir, latestPath),
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
    id: DATASET_ID,
    name,
    rootDir,
    folder,
    validate({ body, receivedAt, payloadSha256 }) {
      return validatePayload(body, receivedAt, payloadSha256);
    },
    persist,
  });
}

module.exports = { createFbaShipmentsAdapter };
