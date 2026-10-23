'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLocalBridgeClient } = require('./bridge-client.js');

function jsonResponse(status, payload) {
  return {
    status,
    responseText: JSON.stringify(payload),
    responseHeaders: 'Content-Type: application/json; charset=utf-8\r\n',
  };
}

test('browser SDK exposes the complete v2 job worker contract', async (t) => {
  const calls = [];
  const token = 't'.repeat(32);
  global.GM_getValue = async () => token;
  global.GM_setValue = async () => undefined;
  global.GM_xmlhttpRequest = (details) => {
    calls.push(details);
    const url = new URL(details.url);
    const base = { ok: true, protocol_version: 2 };
    let response;
    if (url.pathname === '/health') {
      response = jsonResponse(200, {
        ok: true,
        service_id: 'local-automation-bridge',
        protocol_version: 1,
        runtime_summary: { online_clients: 1, online_instances: 1, running: 0, error: 0 },
      });
    } else if (url.pathname === '/v2/runtime/heartbeat') {
      const heartbeat = JSON.parse(details.data);
      response = jsonResponse(200, {
        ...base,
        runtime: {
          client_id: 'userscript.lingxing.fba.v1',
          client_name: 'FBA',
          ...heartbeat,
        },
      });
    } else if (url.pathname === '/v2/runtime/status') {
      response = jsonResponse(200, {
        ...base,
        runtime: {
          generated_at: '2026-10-23T00:00:00.000Z',
          ttl_seconds: 90,
          summary: { online_clients: 1, online_instances: 1, running: 0, error: 0 },
          logical_clients: [],
          instances: [],
        },
      });
    } else if (url.pathname === '/v2/job-capabilities') {
      response = jsonResponse(200, {
        ...base,
        job_capabilities: [{ id: 'lingxing.fba_shipments.refresh', actions: ['execute'] }],
      });
    } else if (url.pathname === '/v2/jobs' && details.method === 'POST') {
      response = jsonResponse(201, {
        ...base,
        duplicate: false,
        job: { job_id: 'job-create-12345678', state: 'pending' },
      });
    } else if (url.pathname === '/v2/jobs/claim') {
      response = jsonResponse(200, {
        ...base,
        job: { job_id: 'job-create-12345678', state: 'running' },
        claim_token: 'c'.repeat(32),
      });
    } else if (url.pathname.endsWith('/progress')) {
      response = jsonResponse(200, {
        ...base,
        job: { job_id: 'job-create-12345678', state: 'running' },
      });
    } else if (url.pathname.endsWith('/complete')) {
      response = jsonResponse(200, {
        ...base,
        duplicate: false,
        job: { job_id: 'job-create-12345678', state: 'succeeded' },
      });
    } else if (url.pathname === '/v2/jobs/job-create-12345678') {
      response = jsonResponse(200, {
        ...base,
        job: { job_id: 'job-create-12345678', state: 'running' },
      });
    } else {
      response = jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'missing' } });
    }
    queueMicrotask(() => details.onload(response));
  };
  t.after(() => {
    delete global.GM_getValue;
    delete global.GM_setValue;
    delete global.GM_xmlhttpRequest;
  });

  const client = createLocalBridgeClient({
    clientId: 'userscript.lingxing.fba.v1',
    baseUrl: 'http://127.0.0.1:32145',
    tokenKey: 'TEST_BRIDGE_TOKEN',
  });
  assert.equal((await client.health()).runtime_summary.online_clients, 1);
  const heartbeat = await client.runtimeHeartbeat({
    instance_id: 'lingxing-fba-worker:12345678',
    state: 'idle',
    version: '1.2.0',
  });
  assert.equal(heartbeat.version, '1.2.0');
  assert.equal((await client.runtimeStatus()).runtime.ttl_seconds, 90);
  assert.equal((await client.jobCapabilities())[0].id, 'lingxing.fba_shipments.refresh');
  assert.equal((await client.createJob('lingxing.fba_shipments.refresh')).job.state, 'pending');
  const claim = await client.claimJobs(
    ['lingxing.fba_shipments.refresh'],
    'lingxing-fba-worker:12345678',
    25000,
  );
  assert.equal(claim.job.state, 'running');
  assert.equal((await client.getJob(claim.job.job_id)).state, 'running');
  assert.equal((await client.reportJobProgress(
    claim.job.job_id,
    claim.claimToken,
    { message: 'fetching', percent: 25 },
  )).state, 'running');
  assert.equal((await client.completeJob(
    claim.job.job_id,
    claim.claimToken,
    'succeeded',
    { result: { dataset_id: 'fba_shipments' } },
  )).job.state, 'succeeded');

  const claimRequest = calls.find((call) => new URL(call.url).pathname === '/v2/jobs/claim');
  assert.deepEqual(JSON.parse(claimRequest.data), {
    capabilities: ['lingxing.fba_shipments.refresh'],
    worker_id: 'lingxing-fba-worker:12345678',
    wait_ms: 25000,
  });
  const completeRequest = calls.find((call) => new URL(call.url).pathname.endsWith('/complete'));
  assert.equal(JSON.parse(completeRequest.data).state, 'succeeded');
  const healthRequest = calls.find((call) => new URL(call.url).pathname === '/health');
  assert.equal(healthRequest.headers.Authorization, undefined);
  assert.ok(calls
    .filter((call) => new URL(call.url).pathname !== '/health')
    .every((call) => call.headers.Authorization === `Bearer ${token}`));
});

test('browser SDK rejects arbitrary worker identifiers and unsupported completion states locally', async (t) => {
  global.GM_getValue = async () => 't'.repeat(32);
  global.GM_setValue = async () => undefined;
  global.GM_xmlhttpRequest = () => assert.fail('invalid input must not reach the bridge');
  t.after(() => {
    delete global.GM_getValue;
    delete global.GM_setValue;
    delete global.GM_xmlhttpRequest;
  });
  const client = createLocalBridgeClient({
    clientId: 'userscript.test.v1',
    baseUrl: 'http://127.0.0.1:32145',
    tokenKey: 'TEST_BRIDGE_TOKEN',
  });
  await assert.rejects(
    client.claimJobs(['lingxing.fba_shipments.refresh'], '../bad', 0),
    (error) => error.code === 'INVALID_WORKER_ID',
  );
  await assert.rejects(
    client.completeJob('job-create-12345678', 'c'.repeat(32), 'cancelled'),
    (error) => error.code === 'INVALID_JOB_COMPLETION',
  );
  await assert.rejects(
    client.runtimeHeartbeat({
      instance_id: 'valid-instance:0001',
      state: 'idle',
      current_job_id: 'job-untrusted',
    }),
    (error) => error.code === 'INVALID_RUNTIME_HEARTBEAT',
  );
});
