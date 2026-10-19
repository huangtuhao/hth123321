'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createBridge } = require('./bridge.cjs');
const { normalizeRegistry } = require('./lib/registry.cjs');

const TEST_TOKEN = 'test-only-token-with-at-least-24-characters';
const execFileAsync = promisify(execFile);

function registryRaw(rootDir, sharedRoot, stateRoot) {
  return {
    schema_version: 1,
    service: {
      host: '127.0.0.1',
      port: 0,
      max_body_bytes: 1024 * 1024,
      state_root: stateRoot,
    },
    stores: {
      lingxing: { name: 'test legacy', root: rootDir },
      shared: { name: 'test shared', root: sharedRoot },
    },
    datasets: {
      fba_shipments: {
        name: 'FBA货件',
        store: 'lingxing',
        folder: 'FBA数据',
        adapter: 'fba_shipments_v1',
      },
    },
    configs: {
      freight_channels: {
        name: '货代渠道配置',
        store: 'shared',
        folder: '配置/货代渠道',
        max_bytes: 65536,
      },
    },
    artifact_buckets: {
      lingxing_fba: {
        name: '领星 FBA 文件',
        store: 'shared',
        folder: '文件/领星FBA',
        max_bytes: 65536,
        allowed_extensions: ['.pdf', '.json'],
      },
    },
    clients: {
      'userscript.lingxing.fba.v1': {
        name: 'legacy',
        aliases: ['lingxing-tampermonkey-v1'],
        pairing: 'legacy_auto',
        allowed_origins: ['https://erp.lingxing.com'],
        permissions: ['dataset:write:fba_shipments'],
      },
      'userscript.lingxing.automation.v2': {
        name: 'generic',
        aliases: [],
        pairing: 'code',
        allowed_origins: ['https://erp.lingxing.com'],
        permissions: [
          'dataset:write:fba_shipments',
          'config:read:freight_channels',
          'config:write:freight_channels',
          'artifact:write:lingxing_fba',
        ],
      },
    },
  };
}

async function startTestBridge(options = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-automation-bridge-'));
  const legacyRoot = path.join(tempRoot, 'legacy');
  const sharedRoot = path.join(tempRoot, 'shared');
  const stateRoot = path.join(tempRoot, 'state');
  const raw = registryRaw(legacyRoot, sharedRoot, stateRoot);
  if (typeof options.mutateRegistry === 'function') options.mutateRegistry(raw);
  const bridge = await createBridge({
    registryRaw: raw,
    port: 0,
    ...(options.staticToken === false ? {} : { token: TEST_TOKEN }),
    maxBodyBytes: options.maxBodyBytes ?? 1024 * 1024,
  });
  const address = await bridge.listen();
  return {
    bridge,
    tempRoot,
    legacyRoot,
    sharedRoot,
    stateRoot,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async cleanup() {
      await bridge.close();
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

function samplePayload(runId = 'test-run-1', recordId = 1001, previousRunId = null, kind = 'delta') {
  return {
    schema_version: 1,
    dataset: 'fba_shipments',
    account_key: 'uid-test-user',
    run_id: runId,
    collected_at: '2026-10-14T09:00:00+08:00',
    export: {
      run_id: runId,
      account_key: 'uid-test-user',
      completed_at: '2026-10-14T09:00:00+08:00',
      kind,
      previous_run_id: previousRunId,
      source: { unique_total: 1 },
      summary: kind === 'baseline'
        ? { added: 1, updated: 0, removed: 0, pending_missing: 0, baseline_records: 1 }
        : { added: 1, updated: 0, removed: 0, pending_missing: 0, baseline_records_after: 1 },
      changes: [{ type: 'add', id: recordId }],
    },
    snapshot: {
      semantics: 'confirmed_next_baseline',
      record_count: 1,
      source_record_count: 1,
      pending_missing: 0,
      source: { endpoint: '/api/fba_shipment/showShipment_v2' },
      records: [{ _record_key: `id:${recordId}`, id: recordId, shipment_id: `FBA-${recordId}` }],
    },
  };
}

async function legacyPair(context) {
  const response = await fetch(`${context.baseUrl}/v1/pair`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-LingXing-Bridge-Client': 'lingxing-tampermonkey-v1',
    },
    body: JSON.stringify({
      protocol_version: 1,
      client: 'lingxing-tampermonkey-v1',
    }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function v2Pair(context) {
  const client = context.bridge.registry.clients['userscript.lingxing.automation.v2'];
  const issued = await context.bridge.auth.issuePairCode(client);
  const response = await fetch(`${context.baseUrl}/v2/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: client.id,
      pairing_code: issued.code,
      instance_id: 'test-instance',
    }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  return { client, issued, token: result.token };
}

function v2Headers(pair, extra = {}) {
  return {
    'X-Local-Bridge-Client': pair.client.id,
    Authorization: `Bearer ${pair.token}`,
    ...extra,
  };
}

test('旧 FBA 插件的 health、配对、ACK 与落盘结构保持兼容', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());

  const healthResponse = await fetch(`${context.baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true);
  assert.equal(health.service, 'lingxing-local-bridge');
  assert.equal(health.service_id, 'local-automation-bridge');
  assert.equal(health.protocol_version, 1);
  assert.deepEqual(health.api_versions, [1, 2]);
  assert.equal(health.data_root, context.legacyRoot);
  assert.equal(health.datasets.fba_shipments.path, path.join(context.legacyRoot, 'FBA数据'));

  const token = await legacyPair(context);
  assert.equal(token, TEST_TOKEN);
  const payloadText = JSON.stringify(samplePayload('baseline-1', 1001, null, 'baseline'), null, 2);
  const ingestResponse = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': token,
    },
    body: payloadText,
  });
  assert.equal(ingestResponse.status, 201);
  const ack = await ingestResponse.json();
  assert.equal(ack.ok, true);
  assert.equal(ack.committed, true);
  assert.equal(ack.protocol_version, 1);
  assert.equal(ack.dataset_id, 'fba_shipments');
  assert.equal(ack.run_id, 'baseline-1');
  assert.equal(ack.account_key, 'uid-test-user');
  assert.equal(ack.record_count, 1);
  assert.equal(ack.ingest_sha256, crypto.createHash('sha256').update(payloadText).digest('hex'));
  assert.equal(ack.dataset_path, path.join(context.legacyRoot, 'FBA数据'));

  const latest = JSON.parse(await fs.readFile(path.join(context.legacyRoot, 'FBA数据', 'latest.json'), 'utf8'));
  assert.equal(latest.records[0].shipment_id, 'FBA-1001');
  const manifest = JSON.parse(await fs.readFile(path.join(context.legacyRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.datasets.fba_shipments.run_id, 'baseline-1');
  assert.equal(manifest.bridge_version, '1.0.0');

  const duplicate = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': token,
    },
    body: payloadText,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
});

test('FBA 谱系、旧提交、run 冲突和账号绑定继续受保护', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  const token = await legacyPair(context);
  const send = (payload) => fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': token,
    },
    body: JSON.stringify(payload),
  });
  assert.equal((await send(samplePayload('base', 1, null, 'baseline'))).status, 201);
  assert.equal((await send(samplePayload('delta', 2, 'base', 'delta'))).status, 201);

  const badLineage = await send(samplePayload('bad-lineage', 3, 'base', 'delta'));
  assert.equal(badLineage.status, 409);
  assert.equal((await badLineage.json()).error.code, 'LINEAGE_MISMATCH');

  const stale = samplePayload('stale', 4, 'delta', 'delta');
  stale.collected_at = '2026-10-13T09:00:00+08:00';
  stale.export.completed_at = stale.collected_at;
  const staleResponse = await send(stale);
  assert.equal(staleResponse.status, 409);
  assert.equal((await staleResponse.json()).error.code, 'STALE_RUN');

  const runConflict = await send(samplePayload('delta', 999, 'base', 'delta'));
  assert.equal(runConflict.status, 409);
  assert.equal((await runConflict.json()).error.code, 'RUN_ID_CONFLICT');

  const otherAccount = samplePayload('other-account', 5, 'delta', 'delta');
  otherAccount.account_key = 'uid-another';
  otherAccount.export.account_key = 'uid-another';
  const accountResponse = await send(otherAccount);
  assert.equal(accountResponse.status, 409);
  assert.equal((await accountResponse.json()).error.code, 'ACCOUNT_MISMATCH');

  const manifest = JSON.parse(await fs.readFile(path.join(context.legacyRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.datasets.fba_shipments.run_id, 'delta');
});

test('拒绝跨域配对、OPTIONS 和超限请求体', async (t) => {
  const context = await startTestBridge({ maxBodyBytes: 1024 });
  t.after(() => context.cleanup());
  const deniedOrigin = await fetch(`${context.baseUrl}/v1/pair`, {
    method: 'POST',
    headers: {
      Origin: 'https://evil.example',
      'X-LingXing-Bridge-Client': 'lingxing-tampermonkey-v1',
    },
  });
  assert.equal(deniedOrigin.status, 403);
  assert.equal((await deniedOrigin.json()).error.code, 'ORIGIN_DENIED');

  const options = await fetch(`${context.baseUrl}/v2/capabilities`, { method: 'OPTIONS' });
  assert.equal(options.status, 403);
  assert.equal((await options.json()).error.code, 'CORS_DISABLED');

  const token = await legacyPair(context);
  const oversized = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': token,
    },
    body: JSON.stringify({ padding: 'x'.repeat(2000) }),
  });
  assert.equal(oversized.status, 413);
});

test('v2 使用一次性配对码、独立 token 与能力清单', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  const pair = await v2Pair(context);

  const capabilityResponse = await fetch(`${context.baseUrl}/v2/capabilities`, {
    headers: v2Headers(pair),
  });
  assert.equal(capabilityResponse.status, 200);
  const capabilities = await capabilityResponse.json();
  assert.equal(capabilities.client.id, pair.client.id);
  assert.ok(capabilities.permissions.includes('config:read:freight_channels'));
  assert.deepEqual(capabilities.resources.configs.map((item) => item.id), ['freight_channels']);

  const reusedResponse = await fetch(`${context.baseUrl}/v2/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: pair.client.id,
      pairing_code: pair.issued.code,
      instance_id: 'another-instance',
    }),
  });
  assert.equal(reusedResponse.status, 403);
  const pairingFiles = await fs.readdir(path.join(context.stateRoot, 'pairing'));
  assert.equal(pairingFiles.length, 0);
  await assert.rejects(fs.access(path.join(context.sharedRoot, '_config')));
  await assert.rejects(fs.access(path.join(context.legacyRoot, '_config')));
});

test('生产模式只保存 v2 token 哈希，实际 token 可以完成认证', async (t) => {
  const context = await startTestBridge({ staticToken: false });
  t.after(() => context.cleanup());
  const client = context.bridge.registry.clients['userscript.lingxing.automation.v2'];
  const issued = await context.bridge.auth.issuePairCode(client);
  const pairingText = await fs.readFile(path.join(context.stateRoot, 'pairing', `${client.id}.json`), 'utf8');
  assert.equal(pairingText.includes(issued.code), false);

  const response = await fetch(`${context.baseUrl}/v2/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: client.id, pairing_code: issued.code }),
  });
  assert.equal(response.status, 200);
  const paired = await response.json();
  assert.ok(paired.token.length >= 32);
  const authText = await fs.readFile(path.join(context.stateRoot, 'client-auth', `${client.id}.json`), 'utf8');
  assert.equal(authText.includes(paired.token), false);
  assert.match(JSON.parse(authText).token_sha256, /^[a-f0-9]{64}$/);

  const capabilities = await fetch(`${context.baseUrl}/v2/capabilities`, {
    headers: {
      'X-Local-Bridge-Client': client.id,
      Authorization: `Bearer ${paired.token}`,
    },
  });
  assert.equal(capabilities.status, 200);
});

test('同一个一次性配对码并发请求也只能成功一次', async (t) => {
  const context = await startTestBridge({ staticToken: false });
  t.after(() => context.cleanup());
  const client = context.bridge.registry.clients['userscript.lingxing.automation.v2'];
  const issued = await context.bridge.auth.issuePairCode(client);
  const pair = () => fetch(`${context.baseUrl}/v2/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: client.id, pairing_code: issued.code }),
  });
  const responses = await Promise.all([pair(), pair()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 403]);
});

test('配置支持发布、幂等、读取、ETag 与 CAS 冲突', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  const pair = await v2Pair(context);
  const publication = {
    schema_version: 1,
    publication_id: 'freight-20261019',
    expected_current_revision: null,
    effective_at: '2026-10-19T00:00:00+08:00',
    expires_at: '2099-10-26T00:00:00+08:00',
    source: { producer: 'test' },
    data: { channels: [{ name: '美西卡派', price: 8.5 }] },
  };
  const publish = () => fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    method: 'PUT',
    headers: v2Headers(pair, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(publication),
  });
  const first = await publish();
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.config.data.channels[0].name, '美西卡派');

  const retry = await publish();
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);

  // 模拟进程在 version 写成后、current/status 写成前退出；重试应完成提交。
  const configDir = path.join(context.sharedRoot, '配置', '货代渠道');
  await fs.unlink(path.join(configDir, 'current.json'));
  await fs.unlink(path.join(configDir, 'status.json'));
  const recovered = await publish();
  assert.equal(recovered.status, 200);
  assert.equal((await recovered.json()).duplicate, true);

  const get = await fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    headers: v2Headers(pair),
  });
  assert.equal(get.status, 200);
  const etag = get.headers.get('etag');
  assert.ok(etag);
  const notModified = await fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    headers: v2Headers(pair, { 'If-None-Match': etag }),
  });
  assert.equal(notModified.status, 304);

  const semanticConflict = await fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    method: 'PUT',
    headers: v2Headers(pair, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ...publication, expires_at: '2099-11-01T00:00:00+08:00' }),
  });
  assert.equal(semanticConflict.status, 409);
  assert.equal((await semanticConflict.json()).error.code, 'PUBLICATION_ID_CONFLICT');

  const conflictPublication = {
    ...publication,
    publication_id: 'freight-conflict',
    data: { channels: [] },
  };
  const conflict = await fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    method: 'PUT',
    headers: v2Headers(pair, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(conflictPublication),
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, 'REVISION_CONFLICT');
});

test('文件上传只允许注册文件桶和安全文件名', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  const pair = await v2Pair(context);
  const file = Buffer.from('%PDF-1.7\ntest');
  const digest = crypto.createHash('sha256').update(file).digest('hex');
  const upload = await fetch(`${context.baseUrl}/v2/artifacts/lingxing_fba?filename=${encodeURIComponent('箱唛.pdf')}`, {
    method: 'POST',
    headers: v2Headers(pair, {
      'Content-Type': 'application/pdf',
      'X-Content-SHA256': digest,
    }),
    body: file,
  });
  assert.equal(upload.status, 201);
  const result = await upload.json();
  assert.equal(result.artifact.sha256, digest);
  assert.match(result.artifact.relative_path, /^文件\/领星FBA\/\d{4}-\d{2}-\d{2}\/箱唛\.pdf$/);
  assert.equal(await fs.readFile(path.join(context.sharedRoot, ...result.artifact.relative_path.split('/')), 'utf8'), file.toString());

  const unsafe = await fetch(`${context.baseUrl}/v2/artifacts/lingxing_fba?filename=${encodeURIComponent('../secret.pdf')}`, {
    method: 'POST',
    headers: v2Headers(pair, { 'Content-Type': 'application/pdf' }),
    body: file,
  });
  assert.equal(unsafe.status, 400);
  assert.equal((await unsafe.json()).error.code, 'INVALID_FILENAME');

  const extension = await fetch(`${context.baseUrl}/v2/artifacts/lingxing_fba?filename=script.exe`, {
    method: 'POST',
    headers: v2Headers(pair, { 'Content-Type': 'application/octet-stream' }),
    body: file,
  });
  assert.equal(extension.status, 415);

  const changed = Buffer.from('%PDF-1.7\nchanged');
  const changedUrl = `${context.baseUrl}/v2/artifacts/lingxing_fba?filename=${encodeURIComponent('箱唛.pdf')}`;
  const changedOnce = await fetch(changedUrl, {
    method: 'POST',
    headers: v2Headers(pair, { 'Content-Type': 'application/pdf' }),
    body: changed,
  });
  assert.equal(changedOnce.status, 201);
  const changedFirstBody = await changedOnce.json();
  assert.match(changedFirstBody.artifact.stored_filename, /-[a-f0-9]{12}\.pdf$/);
  const changedAgain = await fetch(changedUrl, {
    method: 'POST',
    headers: v2Headers(pair, { 'Content-Type': 'application/pdf' }),
    body: changed,
  });
  assert.equal(changedAgain.status, 200);
  const changedAgainBody = await changedAgain.json();
  assert.equal(changedAgainBody.artifact.duplicate, true);
  assert.equal(changedAgainBody.artifact.relative_path, changedFirstBody.artifact.relative_path);
});

test('两个 CLI 进程并发 CAS 发布时只允许一个成功', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-bridge-cli-race-'));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const sharedRoot = path.join(tempRoot, 'shared');
  const legacyRoot = path.join(tempRoot, 'legacy');
  const stateRoot = path.join(tempRoot, 'state');
  const inputA = path.join(tempRoot, 'a.json');
  const inputB = path.join(tempRoot, 'b.json');
  await fs.writeFile(inputA, JSON.stringify({
    publication_id: 'race-a', expected_current_revision: null, data: { value: 'a' },
  }));
  await fs.writeFile(inputB, JSON.stringify({
    publication_id: 'race-b', expected_current_revision: null, data: { value: 'b' },
  }));
  const cliPath = path.join(__dirname, 'bridge-cli.cjs');
  const env = {
    ...process.env,
    LOCAL_AUTOMATION_BRIDGE_SHARED_ROOT: sharedRoot,
    LOCAL_AUTOMATION_BRIDGE_LINGXING_ROOT: legacyRoot,
    LOCAL_AUTOMATION_BRIDGE_STATE_ROOT: stateRoot,
  };
  const run = (input) => execFileAsync(process.execPath, [
    cliPath, 'config', 'publish', 'freight_channels', input,
  ], { env });
  const results = await Promise.allSettled([run(inputA), run(inputB)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const current = JSON.parse(await fs.readFile(path.join(sharedRoot, '配置', '货代渠道', 'current.json'), 'utf8'));
  assert.ok(['race-a', 'race-b'].includes(current.publication_id));
});

test('旧客户端令牌不能读取配置或上传文件', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  const token = await legacyPair(context);
  const response = await fetch(`${context.baseUrl}/v2/configs/freight_channels`, {
    headers: {
      'X-Local-Bridge-Client': 'lingxing-tampermonkey-v1',
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'PERMISSION_DENIED');
});

test('capabilities 按资源类型和动作过滤同名资源', async (t) => {
  const context = await startTestBridge({
    mutateRegistry(raw) {
      raw.configs.fba_shipments = {
        name: '同名但无权配置',
        store: 'shared',
        folder: '配置/同名测试',
        max_bytes: 65536,
      };
    },
  });
  t.after(() => context.cleanup());
  const token = await legacyPair(context);
  const response = await fetch(`${context.baseUrl}/v2/capabilities`, {
    headers: {
      'X-Local-Bridge-Client': 'lingxing-tampermonkey-v1',
      Authorization: `Bearer ${token}`,
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.resources.datasets.map((item) => item.id), ['fba_shipments']);
  assert.equal(body.resources.configs.some((item) => item.id === 'fba_shipments'), false);
});

test('注册表拒绝路径逃逸和保留客户端标识', () => {
  const root = path.join(os.tmpdir(), 'registry-test');
  const raw = registryRaw(path.join(root, 'legacy'), path.join(root, 'shared'), path.join(root, 'state'));
  raw.configs.freight_channels.folder = '../outside';
  assert.throws(() => normalizeRegistry(raw), /不能离开/);

  const badClient = registryRaw(path.join(root, 'legacy'), path.join(root, 'shared'), path.join(root, 'state'));
  badClient.clients.__proto__ = {
    name: 'bad', aliases: [], pairing: 'code', permissions: [],
  };
  // JSON 对象原型污染不会成为 Object.entries 中的自有注册项。
  const normalized = normalizeRegistry(badClient);
  assert.equal(normalized.clients.__proto__, undefined);
});

test('manifest 更新保留未知数据集与顶层字段', async (t) => {
  const context = await startTestBridge();
  t.after(() => context.cleanup());
  await fs.mkdir(context.legacyRoot, { recursive: true });
  await fs.writeFile(path.join(context.legacyRoot, 'manifest.json'), JSON.stringify({
    schema_version: 1,
    custom_top_level: { keep: true },
    datasets: { retired_dataset: { keep: true } },
  }));
  const token = await legacyPair(context);
  const payload = JSON.stringify(samplePayload('baseline-preserve', 42, null, 'baseline'));
  const response = await fetch(`${context.baseUrl}/v1/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LingXing-Bridge-Token': token,
    },
    body: payload,
  });
  assert.equal(response.status, 201);
  const manifest = JSON.parse(await fs.readFile(path.join(context.legacyRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.custom_top_level.keep, true);
  assert.equal(manifest.datasets.retired_dataset.keep, true);
  assert.equal(manifest.datasets.fba_shipments.run_id, 'baseline-preserve');
});
