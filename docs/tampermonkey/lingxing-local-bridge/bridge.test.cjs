'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { createBridge } = require('./bridge.cjs');

const TEST_TOKEN = 'test-only-token-with-at-least-24-characters';

async function startTestBridge(options = {}) {
  const testRoot = path.join(__dirname, '.test-tmp');
  await fs.mkdir(testRoot, { recursive: true });
  const rootDir = await fs.mkdtemp(path.join(testRoot, 'lingxing-bridge-test-'));
  const bridge = await createBridge({
    rootDir,
    port: 0,
    token: TEST_TOKEN,
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
  });
  const address = await bridge.listen();
  return {
    bridge,
    rootDir,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await bridge.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

function samplePayload(runId = 'test-run-1', recordId = 1001, previousRunId = null) {
  return {
    schema_version: 1,
    dataset: 'fba_shipments',
    account_key: 'test-company:test-user',
    run_id: runId,
    collected_at: '2026-10-14T09:00:00+08:00',
    export: {
      run_id: runId,
      account_key: 'test-company:test-user',
      completed_at: '2026-10-14T09:00:00+08:00',
      export_type: 'delta',
      previous_run_id: previousRunId,
      source: { unique_total: 1 },
      summary: {
        added: 1,
        updated: 0,
        removed: 0,
        pending_missing: 0,
        baseline_records_after: 1,
      },
      changes: [{ type: 'add', id: recordId }],
    },
    snapshot: {
      record_count: 1,
      source_record_count: 1,
      pending_missing: 0,
      source: { endpoint: '/api/fba_shipment/showShipment_v2' },
      records: [{ _record_key: `id:${recordId}`, id: recordId, shipment_id: `FBA-${recordId}` }],
    },
  };
}

test('health、认证和完整文件写入', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());

  const healthResponse = await fetch(`${context.baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.protocol_version, 1);
  assert.equal(health.data_root, context.rootDir);

  const pairResponse = await fetch(`${context.baseUrl}/v1/pair`, {
    method: 'POST',
    headers: { 'X-LingXing-Bridge-Client': 'lingxing-tampermonkey-v1' },
  });
  assert.equal(pairResponse.status, 200);
  assert.equal((await pairResponse.json()).token, TEST_TOKEN);

  const unauthorizedResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(samplePayload()),
  });
  assert.equal(unauthorizedResponse.status, 401);

  const payloadText = JSON.stringify(samplePayload());
  const ingestResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: payloadText,
  });
  assert.equal(ingestResponse.status, 201);
  const ingestResult = await ingestResponse.json();
  assert.equal(ingestResult.ok, true);
  assert.equal(ingestResult.committed, true);
  assert.equal(ingestResult.protocol_version, 1);
  assert.equal(ingestResult.dataset_id, 'fba_shipments');
  assert.equal(ingestResult.record_count, 1);
  assert.equal(ingestResult.data_root, context.rootDir);
  assert.equal(ingestResult.dataset_path, path.join(context.rootDir, 'FBA数据'));
  assert.equal(
    ingestResult.ingest_sha256,
    crypto.createHash('sha256').update(payloadText).digest('hex'),
  );

  const latest = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'FBA数据', 'latest.json'), 'utf8'),
  );
  assert.equal(latest.record_count, 1);
  assert.equal(latest.records[0].shipment_id, 'FBA-1001');

  const status = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'FBA数据', 'status.json'), 'utf8'),
  );
  assert.equal(status.state, 'success');
  assert.match(status.latest_sha256, /^[a-f0-9]{64}$/);

  const manifest = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.datasets.fba_shipments.record_count, 1);
  assert.equal(manifest.datasets.fba_shipments.account_key, 'test-company:test-user');
  assert.equal(manifest.datasets.fba_shipments.latest, 'FBA数据/latest.json');

  const changes = await fs.readdir(path.join(context.rootDir, 'FBA数据', 'changes'));
  assert.equal(changes.length, 1);

  const duplicateResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(samplePayload()),
  });
  assert.equal(duplicateResponse.status, 200);
  assert.equal((await duplicateResponse.json()).duplicate, true);
  assert.equal((await fs.readdir(path.join(context.rootDir, 'FBA数据', 'changes'))).length, 1);
});

test('同一前序版本的并发分支只允许一个提交', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());

  const send = (payload) => fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const responses = await Promise.all([
    send(samplePayload('concurrent-1', 2001)),
    send(samplePayload('concurrent-2', 2002)),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);

  const latest = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'FBA数据', 'latest.json'), 'utf8'),
  );
  assert.ok(['concurrent-1', 'concurrent-2'].includes(latest.run_id));

  const manifest = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.datasets.fba_shipments.run_id, latest.run_id);

  const changes = await fs.readdir(path.join(context.rootDir, 'FBA数据', 'changes'));
  assert.equal(changes.length, 1);
});

test('拒绝非白名单 dataset 和超限 payload', async (t) => {
  const context = await startTestBridge({ maxBodyBytes: 1024 });
  t.after(() => context.cleanup());

  const unknownDataset = samplePayload();
  unknownDataset.dataset = 'arbitrary_path';
  const unknownResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(unknownDataset),
  });
  assert.equal(unknownResponse.status, 400);
  assert.equal((await unknownResponse.json()).error.code, 'UNKNOWN_DATASET');

  const oversizedResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify({ padding: 'x'.repeat(2000) }),
  });
  assert.equal(oversizedResponse.status, 413);
});

test('同一数据目录拒绝另一个 account_key', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());

  const send = (payload) => fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  assert.equal((await send(samplePayload('account-1'))).status, 201);
  const anotherAccount = samplePayload('account-2');
  anotherAccount.account_key = 'another-company:another-user';
  anotherAccount.export.account_key = anotherAccount.account_key;
  const conflict = await send(anotherAccount);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'ACCOUNT_MISMATCH');

  const latest = JSON.parse(
    await fs.readFile(path.join(context.rootDir, 'FBA数据', 'latest.json'), 'utf8'),
  );
  assert.equal(latest.account_key, 'test-company:test-user');
});

test('拒绝 wrapper、export 与 snapshot 的交叉字段不一致', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());

  const payload = samplePayload('cross-field-1');
  payload.export.account_key = 'tampered-account';
  const response = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': TEST_TOKEN,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'CROSS_FIELD_MISMATCH');
  await assert.rejects(fs.access(path.join(context.rootDir, 'manifest.json')));
});
