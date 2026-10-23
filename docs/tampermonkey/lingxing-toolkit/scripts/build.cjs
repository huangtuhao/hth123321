'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE_SDK = path.join(ROOT, 'vendor', 'bridge-client.js');
const LINGXING_SDK = path.join(ROOT, 'lib', 'lingxing-page-client.js');
const DIST = path.join(ROOT, 'dist');

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
}

function build(sourceName, outputName, replacements) {
  let source = read(path.join(ROOT, 'src', sourceName));
  for (const [marker, value] of Object.entries(replacements)) {
    if (!source.includes(marker)) {
      throw new Error(`${sourceName} 缺少构建标记 ${marker}`);
    }
    // Function replacement keeps `$&`, `$'` and similar JavaScript source text literal.
    source = source.replace(marker, () => value);
  }
  if (/\/\*__[^*]+__\*\//.test(source)) {
    throw new Error(`${sourceName} 仍包含未替换的构建标记`);
  }
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, outputName), `${source.trim()}\n`, 'utf8');
}

const bridgeSdk = read(BRIDGE_SDK);
const lingxingSdk = read(LINGXING_SDK);

build('request-probe.user.js', '领星ERP-接口探针.user.js', {
  '/*__BRIDGE_CLIENT__*/': bridgeSdk,
});

build('feature-template.user.js', '领星ERP-功能插件模板.user.js', {
  '/*__BRIDGE_CLIENT__*/': bridgeSdk,
  '/*__LINGXING_PAGE_CLIENT__*/': lingxingSdk,
});

console.log(`Built userscripts in ${DIST}`);
