'use strict';

const fs = require('node:fs/promises');
const { AuthStore } = require('./lib/auth-store.cjs');
const { publishConfig, readCurrent } = require('./lib/config-store.cjs');
const { JobStore, TERMINAL_STATES } = require('./lib/job-store.cjs');
const { loadRegistry, resolveClient } = require('./lib/registry.cjs');

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stdout.write(`本地自动化桥 CLI

用法：
  node bridge-cli.cjs health
  node bridge-cli.cjs registry check
  node bridge-cli.cjs client pair-code <client-id> [有效分钟数，默认 10，最大 240]
  node bridge-cli.cjs config list
  node bridge-cli.cjs config get <config-id>
  node bridge-cli.cjs config publish <config-id> <json-file>
  node bridge-cli.cjs job list-capabilities
  node bridge-cli.cjs job status <job-id>
  node bridge-cli.cjs job run <capability> [--input <json-file>] [--idempotency-key <key>]
                          [--ttl <秒>] [--confirm] [--wait] [--timeout <秒>]
`);
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${flag} 必须是正整数`);
  return parsed;
}

function parseJobRunFlags(args) {
  const result = {
    wait: false,
    confirm: false,
    inputPath: null,
    idempotencyKey: null,
    ttlSeconds: null,
    timeoutSeconds: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--wait') {
      result.wait = true;
      continue;
    }
    if (flag === '--confirm') {
      result.confirm = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 缺少参数`);
    index += 1;
    if (flag === '--input') result.inputPath = value;
    else if (flag === '--idempotency-key') result.idempotencyKey = value;
    else if (flag === '--ttl') result.ttlSeconds = positiveInteger(value, '--ttl');
    else if (flag === '--timeout') result.timeoutSeconds = positiveInteger(value, '--timeout');
    else throw new Error(`无法识别的参数：${flag}`);
  }
  return result;
}

async function waitForJob(jobs, jobId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const job = await jobs.get(jobId);
    if (TERMINAL_STATES.has(job.state)) return job;
    if (Date.now() >= deadline) {
      const error = new Error(`等待任务超时：${jobId}`);
      error.code = 'JOB_WAIT_TIMEOUT';
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
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
      job_capabilities: Object.keys(registry.jobCapabilities),
      clients: Object.keys(registry.clients),
    });
    return;
  }

  if (group === 'client' && action === 'pair-code') {
    const client = resolveClient(registry, first);
    if (!client) throw new Error(`客户端未注册：${first ?? ''}`);
    const auth = new AuthStore(registry);
    await auth.init();
    const requestedMinutes = Number(second);
    const ttlMs = Number.isFinite(requestedMinutes) && requestedMinutes > 0
      ? Math.min(requestedMinutes, 240) * 60 * 1000
      : undefined;
    const result = await auth.issuePairCode(client, ttlMs);
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

  if (group === 'job') {
    const jobs = new JobStore(registry);
    await jobs.init();

    if (action === 'list-capabilities') {
      print({ ok: true, job_capabilities: jobs.listCapabilities() });
      return;
    }

    if (action === 'status') {
      if (!first) throw new Error('缺少 job-id');
      print({ ok: true, job: await jobs.get(first) });
      return;
    }

    if (action === 'run') {
      if (!first) throw new Error('缺少 capability');
      const flags = parseJobRunFlags(argv.slice(3));
      const jobInput = flags.inputPath
        ? JSON.parse(await fs.readFile(flags.inputPath, 'utf8'))
        : {};
      const creation = await jobs.create({
        capability: first,
        input: jobInput,
        ...(flags.idempotencyKey ? { idempotency_key: flags.idempotencyKey } : {}),
        ...(flags.ttlSeconds ? { ttl_seconds: flags.ttlSeconds } : {}),
        ...(flags.confirm ? { confirmed: true } : {}),
      }, { creator: { type: 'local_cli', id: 'local-cli' } });
      if (!flags.wait) {
        print({ ok: true, duplicate: creation.duplicate, job: creation.job });
        return;
      }
      const remainingSeconds = Math.max(
        1,
        Math.ceil((Date.parse(creation.job.expires_at) - Date.now()) / 1000) + 1,
      );
      const job = await waitForJob(
        jobs,
        creation.job.job_id,
        flags.timeoutSeconds ?? remainingSeconds,
      );
      print({ ok: job.state === 'succeeded', duplicate: creation.duplicate, job });
      if (job.state !== 'succeeded') process.exitCode = 2;
      return;
    }
  }

  usage();
  throw new Error('无法识别的命令');
}

module.exports = { main, parseJobRunFlags, waitForJob };

if (require.main === module) {
  main().catch((error) => {
    print({
      ok: false,
      error: { code: error.code ?? 'CLI_ERROR', message: error.message },
    });
    process.exitCode = 1;
  });
}
