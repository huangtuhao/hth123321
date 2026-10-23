'use strict';

const { HttpError, isPlainObject } = require('./common.cjs');

const RUNTIME_STATES = new Set(['idle', 'running', 'error']);
const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9._:@-]{7,159}$/i;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9._+-]{0,63}$/i;

function executableCapabilities(registry, client) {
  return Object.values(registry.jobCapabilities)
    .filter((capability) => client.permissions.includes(`job:execute:${capability.id}`))
    .map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      mode: capability.mode,
    }));
}

function validateInstanceId(value) {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw new HttpError(
      400,
      'INVALID_RUNTIME_HEARTBEAT',
      'instance_id 必须是 8 到 160 位安全字符串',
    );
  }
  return value;
}

function validateHeartbeat(body) {
  if (!isPlainObject(body)) {
    throw new HttpError(400, 'INVALID_RUNTIME_HEARTBEAT', '心跳请求必须是 JSON 对象');
  }
  const allowedFields = new Set(['instance_id', 'state', 'version', 'message']);
  const unknownField = Object.keys(body).find((key) => !allowedFields.has(key));
  if (unknownField) {
    throw new HttpError(
      400,
      'INVALID_RUNTIME_HEARTBEAT',
      `心跳请求包含不支持的字段：${unknownField}`,
    );
  }
  const instanceId = validateInstanceId(body.instance_id);
  const state = body.state === undefined ? 'idle' : body.state;
  if (typeof state !== 'string' || !RUNTIME_STATES.has(state)) {
    throw new HttpError(400, 'INVALID_RUNTIME_HEARTBEAT', 'state 必须是 idle、running 或 error');
  }
  let version;
  if (body.version !== undefined && body.version !== null && body.version !== '') {
    if (typeof body.version !== 'string' || !VERSION_PATTERN.test(body.version)) {
      throw new HttpError(
        400,
        'INVALID_RUNTIME_HEARTBEAT',
        'version 必须是 1 到 64 位安全版本字符串',
      );
    }
    version = body.version;
  }
  let message = null;
  if (body.message !== undefined && body.message !== null && body.message !== '') {
    if (
      typeof body.message !== 'string'
      || body.message.length > 500
      || /[\x00-\x1f\x7f]/.test(body.message)
    ) {
      throw new HttpError(
        400,
        'INVALID_RUNTIME_HEARTBEAT',
        'message 必须是不超过 500 字符的字符串',
      );
    }
    message = body.message;
  }
  return { instanceId, state, version, message };
}

class RuntimeStore {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.ttlSeconds = options.ttlSeconds ?? registry.service.runtimePresenceTtlSeconds ?? 90;
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.instances = new Map();
  }

  key(clientId, instanceId) {
    return `${clientId}\0${instanceId}`;
  }

  capabilities(client) {
    return executableCapabilities(this.registry, client);
  }

  purge(nowMs = this.now()) {
    for (const [key, instance] of this.instances) {
      if (instance.expiresAtMs <= nowMs) this.instances.delete(key);
    }
  }

  touch(client, details) {
    const nowMs = this.now();
    this.purge(nowMs);
    const key = this.key(client.id, details.instanceId);
    const previous = this.instances.get(key);
    const firstSeenAtMs = previous?.firstSeenAtMs ?? nowMs;
    const version = details.version === undefined ? previous?.version ?? null : details.version;
    const message = details.message === undefined ? previous?.message ?? null : details.message;
    const record = {
      clientId: client.id,
      clientName: client.name,
      instanceId: details.instanceId,
      state: details.state,
      version,
      message,
      currentJobId: details.currentJobId === undefined
        ? (details.state === 'running' ? previous?.currentJobId ?? null : null)
        : details.currentJobId,
      source: details.source,
      firstSeenAtMs,
      lastSeenAtMs: nowMs,
      expiresAtMs: nowMs + (this.ttlSeconds * 1000),
    };
    this.instances.set(key, record);
    return this.publicInstance(record, this.capabilities(client));
  }

  heartbeat(client, body) {
    const heartbeat = validateHeartbeat(body);
    return this.touch(client, {
      instanceId: heartbeat.instanceId,
      state: heartbeat.state,
      version: heartbeat.version,
      message: heartbeat.message,
      source: 'heartbeat',
    });
  }

  touchJob(client, workerId, job = null) {
    const instanceId = validateInstanceId(workerId);
    this.purge();
    const previous = this.instances.get(this.key(client.id, instanceId));
    if (!job && (previous?.state === 'running' || previous?.state === 'error')) {
      return this.publicInstance(previous, this.capabilities(client));
    }
    let state = 'idle';
    let message = null;
    let currentJobId = null;
    if (job?.state === 'running') {
      state = 'running';
      currentJobId = job.job_id;
    } else if (job?.state === 'failed') {
      state = 'error';
      message = typeof job.error?.message === 'string' ? job.error.message.slice(0, 500) : null;
    }
    return this.touch(client, {
      instanceId,
      state,
      message,
      currentJobId,
      source: 'job',
    });
  }

  publicInstance(instance, capabilities) {
    return {
      client_id: instance.clientId,
      client_name: instance.clientName,
      instance_id: instance.instanceId,
      state: instance.state,
      version: instance.version,
      message: instance.message,
      current_job_id: instance.currentJobId,
      source: instance.source,
      first_seen_at: new Date(instance.firstSeenAtMs).toISOString(),
      last_seen_at: new Date(instance.lastSeenAtMs).toISOString(),
      expires_at: new Date(instance.expiresAtMs).toISOString(),
      capabilities,
    };
  }

  snapshot() {
    const nowMs = this.now();
    this.purge(nowMs);
    const byClient = new Map();
    for (const client of Object.values(this.registry.clients)) {
      const capabilities = this.capabilities(client);
      if (capabilities.length > 0) {
        byClient.set(client.id, { client, capabilities, instances: [] });
      }
    }
    for (const instance of this.instances.values()) {
      const client = this.registry.clients[instance.clientId];
      if (!client) continue;
      const current = byClient.get(client.id) ?? {
        client,
        capabilities: this.capabilities(client),
        instances: [],
      };
      current.instances.push(this.publicInstance(instance, current.capabilities));
      byClient.set(client.id, current);
    }

    const statePriority = { idle: 1, error: 2, running: 3 };
    const logicalClients = [...byClient.values()]
      .map(({ client, capabilities, instances }) => {
        instances.sort((left, right) => left.instance_id.localeCompare(right.instance_id));
        const latest = instances.reduce(
          (found, item) => (!found || item.last_seen_at > found.last_seen_at ? item : found),
          null,
        );
        const state = instances.reduce(
          (found, item) => (statePriority[item.state] > statePriority[found] ? item.state : found),
          'idle',
        );
        return {
          client_id: client.id,
          name: client.name,
          online: instances.length > 0,
          state: instances.length > 0 ? state : 'offline',
          version: latest?.version ?? null,
          last_seen_at: latest?.last_seen_at ?? null,
          capabilities,
          instances,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    const instances = logicalClients.flatMap((client) => client.instances);
    const summary = {
      registered_clients: logicalClients.length,
      online_clients: logicalClients.filter((client) => client.online).length,
      online_instances: instances.length,
      running: logicalClients.filter((client) => client.state === 'running').length,
      error: logicalClients.filter((client) => client.state === 'error').length,
    };
    return {
      generated_at: new Date(nowMs).toISOString(),
      ttl_seconds: this.ttlSeconds,
      summary,
      logical_clients: logicalClients,
      instances,
    };
  }

  summary() {
    const snapshot = this.snapshot();
    return { ttl_seconds: snapshot.ttl_seconds, ...snapshot.summary };
  }
}

module.exports = {
  RuntimeStore,
  validateHeartbeat,
  validateInstanceId,
};
