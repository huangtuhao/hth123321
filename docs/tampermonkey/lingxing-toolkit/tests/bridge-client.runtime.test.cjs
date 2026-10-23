'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const sdkPath = path.resolve(__dirname, '..', 'vendor', 'bridge-client.js');

function jsonResponse(payload, status = 200) {
  return {
    status,
    responseHeaders: 'Content-Type: application/json; charset=UTF-8\r\n',
    responseText: JSON.stringify(payload),
  };
}

test('health is anonymous while runtime status is authenticated and validated', async () => {
  const calls = [];
  global.GM_getValue = () => 'paired-token';
  global.GM_setValue = () => {};
  global.GM_xmlhttpRequest = (details) => {
    calls.push(details);
    if (details.url.endsWith('/health')) {
      details.onload(jsonResponse({
        ok: true,
        service_id: 'local-automation-bridge',
        runtime_summary: { online_clients: 2, online_instances: 3, running: 1, error: 0 },
      }));
      return;
    }
    details.onload(jsonResponse({
      ok: true,
      protocol_version: 2,
      request_id: 'request-1',
      runtime: {
        generated_at: '2026-10-23T00:00:00.000Z',
        ttl_seconds: 90,
        summary: { registered_clients: 2, online_clients: 2, online_instances: 3, running: 1, error: 0 },
        logical_clients: [],
        instances: [],
      },
    }));
  };

  delete require.cache[sdkPath];
  const { createLocalBridgeClient } = require(sdkPath);
  const client = createLocalBridgeClient({
    clientId: 'userscript.test.runtime',
    baseUrl: 'http://127.0.0.1:32145',
    tokenKey: 'runtime-test-token',
  });

  const health = await client.health();
  const status = await client.runtimeStatus();
  assert.equal(health.runtime_summary.online_clients, 2);
  assert.equal(status.runtime.summary.running, 1);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer paired-token');
  assert.equal(calls[1].url, 'http://127.0.0.1:32145/v2/runtime/status');
});

test('missing pairing does not prevent anonymous health summary', async () => {
  global.GM_getValue = () => '';
  global.GM_setValue = () => {};
  global.GM_xmlhttpRequest = (details) => details.onload(jsonResponse({
    ok: true,
    service_id: 'local-automation-bridge',
    runtime_summary: { online_clients: 1, online_instances: 1, running: 0, error: 0 },
  }));

  delete require.cache[sdkPath];
  const { createLocalBridgeClient } = require(sdkPath);
  const client = createLocalBridgeClient({
    clientId: 'userscript.test.unpaired',
    baseUrl: 'http://127.0.0.1:32145',
    tokenKey: 'runtime-test-unpaired-token',
  });

  assert.equal((await client.health()).runtime_summary.online_clients, 1);
  await assert.rejects(client.runtimeStatus(), (error) => (
    error.code === 'PAIRING_REQUIRED' && error.requiresPairing === true
  ));
});
