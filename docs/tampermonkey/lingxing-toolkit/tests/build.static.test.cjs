'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const root = path.resolve(__dirname, '..');
childProcess.execFileSync(process.execPath, [path.join(root, 'scripts', 'build.cjs')], {
  cwd: root,
  stdio: 'pipe',
});

const probe = fs.readFileSync(path.join(root, 'dist', '领星ERP-接口探针.user.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'dist', '领星ERP-功能插件模板.user.js'), 'utf8');

for (const [name, source] of [['probe', probe], ['template', template]]) {
  assert.match(source, /@match\s+https:\/\/erp\.lingxing\.com\/\*/);
  assert.doesNotMatch(source, /@match\s+\*:\/\/\*\/\*/);
  assert.doesNotMatch(source, /\/\*__[^*]+__\*\//);
  assert.doesNotThrow(() => new Function(source.replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, '')));
  assert.match(source, /@connect\s+127\.0\.0\.1/);
  console.log(`ok - ${name} metadata and syntax`);
}

assert.match(probe, /userscript\.lingxing\.request-probe\.v1/);
assert.match(probe, /lingxing_request_samples/);
assert.match(probe, /recording/);
assert.match(probe, /@version\s+1\.1\.0/);
assert.match(probe, /\u9886\u661f\u81ea\u52a8\u5316\u4e2d\u5fc3/);
assert.match(probe, /class="panel collapsed"/);
assert.match(probe, /runtimeStatus/);
assert.match(probe, /runtime:read/);
assert.match(probe, /\u63a5\u53e3\u63a2\u9488（\u9ad8\u7ea7\u5de5\u5177）/);
assert.equal((probe.match(/GM_registerMenuCommand\(/g) || []).length, 1);
assert.match(probe, /GM_registerMenuCommand\('领星自动化中心：显示状态栏'/);
assert.equal((probe.match(/installNetworkHooks\(\);/g) || []).length, 1);
assert.doesNotMatch(probe, /setInterval\([^)]*(replay|paginate)/i);
assert.match(template, /setupComplete:\s*false/);
assert.match(template, /requiredTransports/);
assert.match(template, /@version\s+1\.1\.0/);
assert.match(template, /function runtimeHeartbeatPayload\(\)/);
assert.match(template, /\.runtimeHeartbeat\(runtimeHeartbeatPayload\(\)\)/);
assert.match(template, /\['idle', 'running', 'error'\]\.includes\(state\)/);
assert.match(template, /if \(!FEATURE\.setupComplete\) return;/);
assert.match(template, /setInterval\(\(\) => \{ void sendRuntimeHeartbeat\(\); \}, 20000\)/);
console.log('ok - probe and template safety invariants');
