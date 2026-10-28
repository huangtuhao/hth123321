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
assert.match(probe, /@version\s+1\.3\.3/);
assert.match(probe, /<span class="title">领星接口探针<\/span>/);
assert.match(probe, /<section class="panel">/);
assert.match(probe, /position:fixed;left:12px;bottom:92px/);
assert.match(probe, /class="select-all-input" type="checkbox" disabled/);
assert.match(probe, /state\.ui\.selectAll\.indeterminate = selectedCount > 0 && !allSelected/);
assert.match(probe, /setAllEntriesSelected\(state\.ui\.selectAll\.checked\)/);
assert.doesNotMatch(probe, /领星自动化中心/);
assert.doesNotMatch(probe, /class="panel collapsed"/);
assert.doesNotMatch(probe, /function refreshRuntimeStatus\s*\(/);
assert.doesNotMatch(probe, /state\.runtime/);
assert.doesNotMatch(probe, /@grant\s+GM_registerMenuCommand/);
assert.doesNotMatch(probe, /\bGM_registerMenuCommand\s*\(/);
assert.match(probe, /lingxing-request-probe-sidebar-entry-v1/);
assert.match(probe, /\.sideBar-container > ul\.el-menu\[role="menubar"\]/);
assert.match(probe, /entry\.setAttribute\('role', 'menuitem'\)/);
assert.match(probe, /label\.textContent = '探针'/);
assert.match(probe, /entry\.title = '领星接口探针'/);
assert.match(probe, /function ensureSidebarEntry\s*\(/);
assert.match(probe, /function toggleUi\s*\(/);
assert.match(probe, /function hideUi\s*\(/);
assert.match(probe, /SIDEBAR_INITIAL_DELAY_MS = 3000/);
assert.match(probe, /setTimeout\([\s\S]{0,300}SIDEBAR_INITIAL_DELAY_MS\)/);
assert.match(probe, /setInterval\(ensureSidebarEntry, SIDEBAR_WATCHDOG_MS\)/);
assert.match(probe, /function positionSidebarEntry\s*\(/);
assert.match(probe, /function normalizeSidebarPluginEntries\s*\(/);
assert.match(probe, /li\.lx-local-plugin-sidebar-entry/);
assert.match(probe, /Number\.MAX_SAFE_INTEGER/);
assert.match(probe, /compareText\(left\.dataset\.lxToolEntry/);
assert.match(probe, /const currentTail = \[\.\.\.menu\.children\]\.slice\(-pluginEntries\.length\)/);
assert.match(probe, /currentTail\.every\(\(entry, index\) => entry === pluginEntries\[index\]\)/);
assert.match(probe, /pluginEntries\.forEach\(\(entry\) => menu\.appendChild\(entry\)\)/);
assert.match(probe, /querySelector\('i\.lx_nav_set'\)/);
assert.match(probe, /if \(!findSettingsSidebarItem\(menu\)\) return/);
assert.match(probe, /classList\.toggle\('is-active', visible\)/);
assert.match(probe, /aria-expanded/);
assert.doesNotMatch(probe, /DOMContentLoaded', createUi/);
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
