'use strict';

const fs = require('node:fs/promises');
const { AuthStore } = require('./lib/auth-store.cjs');
const { publishConfig, readCurrent } = require('./lib/config-store.cjs');
const { loadRegistry, resolveClient } = require('./lib/registry.cjs');

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`本地自动化桥 CLI

用法：
  node bridge-cli.cjs health
  node bridge-cli.cjs registry check
  node bridge-cli.cjs client pair-code <client-id>
  node bridge-cli.cjs config list
  node bridge-cli.cjs config get <config-id>
  node bridge-cli.cjs config publish <config-id> <json-file>
`);
}

async function main(argv = process.argv.slice(2)) {
  const { configPath, registry } = loadRegistry();
  const [group, action, first, second] = argv;
  if (!group || group === 'help' || group === '--help' || group === '-h') {
    usage();
    return;
  }

  if (group === 'health') {
    const response = await fetch(`http://${registry.service.host}:${registry.service.port}/health`);
    const body = await response.json();
    print({ http_status: response.status, ...body });
    if (!response.ok || body.ok !== true) process.exitCode = 1;
    return;
  }

  if (group === 'registry' && action === 'check') {
    print({
      ok: true,
      config_path: configPath,
      state_root: registry.service.stateRoot,
      stores: Object.keys(registry.stores),
      datasets: Object.keys(registry.datasets),
      configs: Object.keys(registry.configs),
      artifact_buckets: Object.keys(registry.artifactBuckets),
      clients: Object.keys(registry.clients),
    });
    return;
  }

  if (group === 'client' && action === 'pair-code') {
    const client = resolveClient(registry, first);
    if (!client) throw new Error(`客户端未注册：${first ?? ''}`);
    const auth = new AuthStore(registry);
    await auth.init();
    const result = await auth.issuePairCode(client);
    print({
      ok: true,
      client_id: client.id,
      pairing_code: result.code,
      expires_at: result.expiresAt,
      permissions: client.permissions,
      note: '配对码只能使用一次，请只交给目标油猴插件。',
    });
    return;
  }

  if (group === 'config' && action === 'list') {
    print({
      ok: true,
      configs: Object.values(registry.configs).map((definition) => ({
        id: definition.id,
        name: definition.name,
      })),
    });
    return;
  }

  if (group === 'config' && action === 'get') {
    const definition = registry.configs[first];
    if (!definition) throw new Error(`配置资源未注册：${first ?? ''}`);
    print({ ok: true, config: await readCurrent(definition, { allowExpired: true }) });
    return;
  }

  if (group === 'config' && action === 'publish') {
    const definition = registry.configs[first];
    if (!definition) throw new Error(`配置资源未注册：${first ?? ''}`);
    if (!second) throw new Error('缺少 JSON 文件路径');
    const input = JSON.parse(await fs.readFile(second, 'utf8'));
    const result = await publishConfig(definition, input, {
      clientId: 'local-cli',
      via: 'local-cli',
    });
    print({
      ok: true,
      resource_id: definition.id,
      revision: result.document.revision,
      duplicate: result.duplicate,
      config: result.document,
    });
    return;
  }

  usage();
  throw new Error('无法识别的命令');
}

main().catch((error) => {
  print({ ok: false, error: { code: 'CLI_ERROR', message: error.message } });
  process.exitCode = 1;
});
