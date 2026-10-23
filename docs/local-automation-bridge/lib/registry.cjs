'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  assertSafeId,
  isPlainObject,
  parsePositiveInteger,
  resolveContainedPath,
} = require('./common.cjs');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'bridge.config.json');
const RESOURCE_PERMISSION_PATTERN = /^(dataset:write|config:read|config:write|artifact:write|job:create|job:read|job:execute):([a-z0-9][a-z0-9._-]{0,127})$/i;
const GLOBAL_PERMISSIONS = new Set(['runtime:read']);

function expandEnvironment(value, env) {
  return String(value).replace(/%([^%]+)%/g, (match, name) => {
    const found = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found ? String(found[1]) : match;
  });
}

function objectEntries(value, fieldName) {
  if (!isPlainObject(value)) throw new Error(`${fieldName} 必须是 JSON 对象`);
  return Object.entries(value);
}

function normalizeRegistry(raw, options = {}) {
  if (!isPlainObject(raw) || raw.schema_version !== 1) {
    throw new Error('bridge.config.json 必须是 schema_version=1 的 JSON 对象');
  }
  const env = options.env ?? process.env;
  const serviceRaw = isPlainObject(raw.service) ? raw.service : {};
  const host = String(options.host ?? serviceRaw.host ?? '127.0.0.1');
  if (host !== '127.0.0.1') throw new Error('出于安全原因，本地桥只允许绑定到 127.0.0.1');
  const stateRootValue = options.stateRoot
    ?? env.LOCAL_AUTOMATION_BRIDGE_STATE_ROOT
    ?? serviceRaw.state_root
    ?? path.join(env.LOCALAPPDATA || __dirname, 'LocalAutomationBridge');
  const stateRoot = path.resolve(expandEnvironment(stateRootValue, env));

  const stores = Object.create(null);
  for (const [id, definition] of objectEntries(raw.stores, 'stores')) {
    assertSafeId(id, `stores.${id}`);
    if (!isPlainObject(definition)) throw new Error(`stores.${id} 必须是 JSON 对象`);
    let rootValue = definition.root;
    if (id === 'lingxing') {
      rootValue = options.legacyRoot
        ?? env.LOCAL_AUTOMATION_BRIDGE_LINGXING_ROOT
        ?? env.LINGXING_BRIDGE_ROOT
        ?? rootValue;
    } else if (id === 'shared') {
      rootValue = options.sharedRoot
        ?? env.LOCAL_AUTOMATION_BRIDGE_SHARED_ROOT
        ?? rootValue;
    }
    const expandedRoot = expandEnvironment(rootValue, env);
    if (!path.isAbsolute(expandedRoot)) throw new Error(`stores.${id}.root 必须是绝对路径`);
    stores[id] = Object.freeze({
      id,
      name: String(definition.name ?? id),
      rootDir: path.resolve(expandedRoot),
    });
  }

  const normalizeResource = (kind, id, definition) => {
    assertSafeId(id, `${kind}.${id}`);
    if (!isPlainObject(definition)) throw new Error(`${kind}.${id} 必须是 JSON 对象`);
    const store = stores[definition.store];
    if (!store) throw new Error(`${kind}.${id}.store 未注册`);
    const resourcePath = resolveContainedPath(store.rootDir, definition.folder, `${kind}.${id}.folder`);
    return {
      id,
      name: String(definition.name ?? id),
      storeId: store.id,
      rootDir: store.rootDir,
      folder: definition.folder,
      resourcePath,
    };
  };

  const datasets = Object.create(null);
  for (const [id, definition] of objectEntries(raw.datasets ?? {}, 'datasets')) {
    const resource = normalizeResource('datasets', id, definition);
    const adapter = String(definition.adapter ?? '');
    if (!adapter) throw new Error(`datasets.${id}.adapter 不能为空`);
    datasets[id] = Object.freeze({ ...resource, adapter });
  }

  const configs = Object.create(null);
  for (const [id, definition] of objectEntries(raw.configs ?? {}, 'configs')) {
    const resource = normalizeResource('configs', id, definition);
    configs[id] = Object.freeze({
      ...resource,
      maxBytes: parsePositiveInteger(definition.max_bytes, 1024 * 1024, `configs.${id}.max_bytes`, {
        minimum: 1024,
        maximum: 128 * 1024 * 1024,
      }),
    });
  }

  const artifactBuckets = Object.create(null);
  for (const [id, definition] of objectEntries(raw.artifact_buckets ?? {}, 'artifact_buckets')) {
    const resource = normalizeResource('artifact_buckets', id, definition);
    const allowedExtensions = Array.isArray(definition.allowed_extensions)
      ? definition.allowed_extensions.map((extension) => String(extension).toLowerCase())
      : [];
    if (allowedExtensions.some((extension) => !/^\.[a-z0-9]{1,12}$/i.test(extension))) {
      throw new Error(`artifact_buckets.${id}.allowed_extensions 存在无效扩展名`);
    }
    artifactBuckets[id] = Object.freeze({
      ...resource,
      maxBytes: parsePositiveInteger(
        definition.max_bytes,
        64 * 1024 * 1024,
        `artifact_buckets.${id}.max_bytes`,
        { minimum: 1024, maximum: 1024 * 1024 * 1024 },
      ),
      allowedExtensions: Object.freeze(allowedExtensions),
    });
  }

  const jobCapabilities = Object.create(null);
  for (const [id, definition] of objectEntries(raw.job_capabilities ?? {}, 'job_capabilities')) {
    assertSafeId(id, `job_capabilities.${id}`);
    if (!isPlainObject(definition)) throw new Error(`job_capabilities.${id} 必须是 JSON 对象`);
    const mode = String(definition.mode ?? 'read_only');
    if (!['read_only', 'write'].includes(mode)) {
      throw new Error(`job_capabilities.${id}.mode 必须是 read_only 或 write`);
    }
    const inputMode = String(definition.input_mode ?? 'object');
    if (!['none', 'object'].includes(inputMode)) {
      throw new Error(`job_capabilities.${id}.input_mode 必须是 none 或 object`);
    }
    const maxTtlSeconds = parsePositiveInteger(
      definition.max_ttl_seconds,
      60 * 60,
      `job_capabilities.${id}.max_ttl_seconds`,
      { minimum: 1, maximum: 7 * 24 * 60 * 60 },
    );
    const defaultTtlSeconds = parsePositiveInteger(
      definition.default_ttl_seconds,
      Math.min(10 * 60, maxTtlSeconds),
      `job_capabilities.${id}.default_ttl_seconds`,
      { minimum: 1, maximum: maxTtlSeconds },
    );
    const confirmationRequired = definition.requires_confirmation === undefined
      ? mode === 'write'
      : definition.requires_confirmation === true;
    if (mode === 'write' && !confirmationRequired) {
      throw new Error(`job_capabilities.${id}.requires_confirmation 写操作必须为 true`);
    }
    jobCapabilities[id] = Object.freeze({
      id,
      name: String(definition.name ?? id),
      description: String(definition.description ?? ''),
      mode,
      inputMode,
      confirmationRequired,
      defaultTtlSeconds,
      maxTtlSeconds,
      leaseSeconds: parsePositiveInteger(
        definition.lease_seconds,
        30,
        `job_capabilities.${id}.lease_seconds`,
        { minimum: 1, maximum: 10 * 60 },
      ),
      maxInputBytes: parsePositiveInteger(
        definition.max_input_bytes,
        256 * 1024,
        `job_capabilities.${id}.max_input_bytes`,
        { minimum: 2, maximum: 128 * 1024 * 1024 },
      ),
      maxResultBytes: parsePositiveInteger(
        definition.max_result_bytes,
        4 * 1024 * 1024,
        `job_capabilities.${id}.max_result_bytes`,
        { minimum: 2, maximum: 128 * 1024 * 1024 },
      ),
      maxProgressBytes: parsePositiveInteger(
        definition.max_progress_bytes,
        64 * 1024,
        `job_capabilities.${id}.max_progress_bytes`,
        { minimum: 2, maximum: 4 * 1024 * 1024 },
      ),
    });
  }

  const clients = Object.create(null);
  const clientAliases = Object.create(null);
  for (const [id, definition] of objectEntries(raw.clients ?? {}, 'clients')) {
    assertSafeId(id, `clients.${id}`);
    if (!isPlainObject(definition)) throw new Error(`clients.${id} 必须是 JSON 对象`);
    const pairing = String(definition.pairing ?? 'disabled');
    if (!['legacy_auto', 'code', 'disabled'].includes(pairing)) {
      throw new Error(`clients.${id}.pairing 不受支持`);
    }
    const aliases = Array.isArray(definition.aliases) ? definition.aliases.map(String) : [];
    const permissions = Array.isArray(definition.permissions) ? definition.permissions.map(String) : [];
    for (const permission of permissions) {
      if (GLOBAL_PERMISSIONS.has(permission)) continue;
      const match = RESOURCE_PERMISSION_PATTERN.exec(permission);
      if (!match) throw new Error(`clients.${id}.permissions 包含无效权限：${permission}`);
      const [, action, resourceId] = match;
      const exists = action === 'dataset:write'
        ? datasets[resourceId]
        : action.startsWith('config:')
          ? configs[resourceId]
          : action === 'artifact:write'
            ? artifactBuckets[resourceId]
            : jobCapabilities[resourceId];
      if (!exists) throw new Error(`clients.${id}.permissions 引用了未注册资源：${permission}`);
    }
    const client = Object.freeze({
      id,
      name: String(definition.name ?? id),
      aliases: Object.freeze(aliases),
      pairing,
      allowedOrigins: Object.freeze(
        Array.isArray(definition.allowed_origins) ? definition.allowed_origins.map(String) : [],
      ),
      permissions: Object.freeze(permissions),
    });
    clients[id] = client;
    for (const alias of [id, ...aliases]) {
      assertSafeId(alias, `clients.${id}.aliases`);
      if (clientAliases[alias]) throw new Error(`客户端标识重复：${alias}`);
      clientAliases[alias] = client;
    }
  }

  const service = Object.freeze({
    host,
    port: parsePositiveInteger(
      options.port ?? env.LOCAL_AUTOMATION_BRIDGE_PORT ?? env.LINGXING_BRIDGE_PORT ?? serviceRaw.port,
      32145,
      '端口',
      { minimum: 0, maximum: 65535 },
    ),
    maxBodyBytes: parsePositiveInteger(
      options.maxBodyBytes
        ?? env.LOCAL_AUTOMATION_BRIDGE_MAX_BYTES
        ?? env.LINGXING_BRIDGE_MAX_BYTES
        ?? serviceRaw.max_body_bytes,
      128 * 1024 * 1024,
      '最大请求体字节数',
      { minimum: 1024, maximum: 1024 * 1024 * 1024 },
    ),
    stateRoot,
    jobRetentionDays: parsePositiveInteger(
      serviceRaw.job_retention_days,
      30,
      'service.job_retention_days',
      { minimum: 1, maximum: 3650 },
    ),
    jobHistoryLimit: parsePositiveInteger(
      serviceRaw.job_history_limit,
      1000,
      'service.job_history_limit',
      { minimum: 1, maximum: 100000 },
    ),
    runtimePresenceTtlSeconds: parsePositiveInteger(
      serviceRaw.runtime_presence_ttl_seconds,
      90,
      'service.runtime_presence_ttl_seconds',
      { minimum: 15, maximum: 60 * 60 },
    ),
  });

  return Object.freeze({
    schemaVersion: 1,
    service,
    stores: Object.freeze(stores),
    datasets: Object.freeze(datasets),
    configs: Object.freeze(configs),
    artifactBuckets: Object.freeze(artifactBuckets),
    jobCapabilities: Object.freeze(jobCapabilities),
    clients: Object.freeze(clients),
    clientAliases: Object.freeze(clientAliases),
  });
}

function loadRegistry(options = {}) {
  const configPath = path.resolve(options.configPath ?? process.env.LOCAL_AUTOMATION_BRIDGE_CONFIG ?? DEFAULT_CONFIG_PATH);
  let raw = options.raw;
  if (!raw) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`无法读取本地桥注册表 ${configPath}：${error.message}`);
    }
  }
  return { configPath, registry: normalizeRegistry(raw, options) };
}

function resolveClient(registry, value) {
  return typeof value === 'string' ? registry.clientAliases[value] ?? null : null;
}

function hasPermission(client, permission) {
  return Boolean(client?.permissions.includes(permission));
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  hasPermission,
  loadRegistry,
  normalizeRegistry,
  resolveClient,
};
