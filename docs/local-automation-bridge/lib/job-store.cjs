'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HttpError,
  assertSafeId,
  isPlainObject,
  readJsonFile,
  safeTokenEquals,
  serializeJson,
  sha256,
  withFileLock,
  writeJsonAtomic,
} = require('./common.cjs');

const TERMINAL_STATES = new Set(['succeeded', 'failed', 'expired']);
const IDEMPOTENCY_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

function jsonBytes(value, fieldName) {
  let text;
  try {
    text = serializeJson(value);
  } catch (error) {
    if (error instanceof HttpError) {
      throw new HttpError(400, 'INVALID_JOB_PAYLOAD', `${fieldName} 不是可序列化 JSON`);
    }
    throw error;
  }
  return { text, bytes: Buffer.byteLength(text), sha256: sha256(text) };
}

function requireSize(value, maximum, fieldName) {
  const serialized = jsonBytes(value, fieldName);
  if (serialized.bytes > maximum) {
    throw new HttpError(413, 'JOB_PAYLOAD_TOO_LARGE', `${fieldName} 超过 ${maximum} 字节限制`);
  }
  return serialized;
}

function normalizeCreator(value) {
  const type = value?.type === 'client' ? 'client' : 'local_cli';
  const id = String(value?.id ?? (type === 'client' ? '' : 'local-cli'));
  try {
    assertSafeId(id, 'creator.id');
  } catch {
    throw new HttpError(400, 'INVALID_JOB_CREATOR', '任务创建者标识无效');
  }
  return { type, id };
}

function publicJob(job) {
  const {
    request_sha256: ignoredRequestSha,
    claim_token_sha256: ignoredClaimSha,
    final_claim_token_sha256: ignoredFinalClaimSha,
    ...visible
  } = job;
  return visible;
}

function parseJobId(jobId) {
  try {
    return assertSafeId(jobId, 'job_id');
  } catch {
    throw new HttpError(400, 'INVALID_JOB_ID', 'job_id 格式无效');
  }
}

function idempotencyIndexKey(creator, capabilityId, idempotencyKey) {
  return sha256([creator.type, creator.id, capabilityId, idempotencyKey].join('\0'));
}

class JobStore {
  constructor(registry) {
    this.registry = registry;
    this.rootDir = path.join(registry.service.stateRoot, 'jobs');
    this.itemsDir = path.join(this.rootDir, 'items');
    this.idempotencyDir = path.join(this.rootDir, 'idempotency');
    this.quarantineDir = path.join(this.rootDir, 'quarantine');
    this.activeIndexPath = path.join(this.rootDir, 'active.json');
    this.lockPath = path.join(this.rootDir, '.queue.lock');
    this.lastCleanupAt = 0;
  }

  async init() {
    await Promise.all([
      fs.mkdir(this.itemsDir, { recursive: true }),
      fs.mkdir(this.idempotencyDir, { recursive: true }),
      fs.mkdir(this.quarantineDir, { recursive: true }),
    ]);
    await this.cleanup();
  }

  capability(capabilityId) {
    const capability = typeof capabilityId === 'string'
      ? this.registry.jobCapabilities[capabilityId]
      : null;
    if (!capability) {
      throw new HttpError(404, 'CAPABILITY_NOT_FOUND', `任务能力未注册：${capabilityId ?? ''}`);
    }
    return capability;
  }

  listCapabilities() {
    return Object.values(this.registry.jobCapabilities).map((capability) => ({
      id: capability.id,
      name: capability.name,
      description: capability.description,
      mode: capability.mode,
      input_mode: capability.inputMode,
      requires_confirmation: capability.confirmationRequired,
      default_ttl_seconds: capability.defaultTtlSeconds,
      max_ttl_seconds: capability.maxTtlSeconds,
      lease_seconds: capability.leaseSeconds,
      max_input_bytes: capability.maxInputBytes,
      max_result_bytes: capability.maxResultBytes,
    }));
  }

  itemPath(jobId) {
    return path.join(this.itemsDir, `${parseJobId(jobId)}.json`);
  }

  async readActiveJobIds() {
    const index = await readJsonFile(this.activeIndexPath, {
      schema_version: 1,
      job_ids: [],
    });
    if (!isPlainObject(index) || !Array.isArray(index.job_ids)) {
      throw new Error('任务活动索引结构无效');
    }
    return new Set(index.job_ids.map((jobId) => parseJobId(jobId)));
  }

  async writeActiveJobIds(jobIds) {
    await writeJsonAtomic(this.activeIndexPath, {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      job_ids: [...jobIds].sort(),
    });
  }

  async readJob(jobId) {
    try {
      const job = await readJsonFile(this.itemPath(jobId));
      if (!isPlainObject(job) || job.job_id !== jobId || !this.registry.jobCapabilities[job.capability]) {
        throw new Error(`任务文件 ${jobId} 结构无效`);
      }
      return job;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HttpError(404, 'JOB_NOT_FOUND', `任务不存在：${jobId}`);
      }
      throw error;
    }
  }

  async expireIfNeeded(job, now = new Date()) {
    if (TERMINAL_STATES.has(job.state) || Date.parse(job.expires_at) > now.getTime()) return job;
    const timestamp = now.toISOString();
    const expired = {
      ...job,
      state: 'expired',
      updated_at: timestamp,
      completed_at: timestamp,
      claimed_by: null,
      claim_token_sha256: null,
      lease_expires_at: null,
      error: {
        code: 'JOB_EXPIRED',
        message: '任务在有效期内未完成',
      },
    };
    await writeJsonAtomic(this.itemPath(job.job_id), expired);
    return expired;
  }

  async quarantineCorruptJob(filePath, filename, error) {
    const destination = path.join(
      this.quarantineDir,
      `${filename}.${Date.now()}-${crypto.randomBytes(4).toString('hex')}.corrupt`,
    );
    try {
      await fs.rename(filePath, destination);
      console.warn(`[本地自动化桥] 已隔离损坏任务文件 ${filename}: ${error.message}`);
    } catch (renameError) {
      if (renameError.code !== 'ENOENT') {
        console.warn(`[本地自动化桥] 无法隔离损坏任务文件 ${filename}: ${renameError.message}`);
      }
    }
  }

  async cleanup(now = new Date()) {
    const result = await withFileLock(this.lockPath, async () => {
      const terminalJobs = [];
      const activeJobIds = new Set();
      const filenames = (await fs.readdir(this.itemsDir))
        .filter((filename) => /^job-[a-z0-9-]+\.json$/i.test(filename));
      for (const filename of filenames) {
        const filePath = path.join(this.itemsDir, filename);
        const jobId = filename.slice(0, -'.json'.length);
        let job;
        try {
          job = await this.readJob(jobId);
        } catch (error) {
          if (error instanceof HttpError && error.code === 'JOB_NOT_FOUND') continue;
          const corrupt = error instanceof SyntaxError
            || (!error.code && /^任务文件 .* 结构无效$/.test(error.message));
          if (!corrupt) throw error;
          await this.quarantineCorruptJob(filePath, filename, error);
          continue;
        }
        // 过期状态写入失败属于真实 I/O 故障，必须向上抛出；不能把有效任务
        // 当成坏 JSON 隔离，也不能在重建 active.json 时悄悄漏掉它。
        job = await this.expireIfNeeded(job, now);
        if (TERMINAL_STATES.has(job.state)) {
          terminalJobs.push({ job, filePath });
        } else {
          activeJobIds.add(job.job_id);
        }
      }
      terminalJobs.sort((left, right) => {
        const leftTime = Date.parse(left.job.completed_at ?? left.job.updated_at ?? left.job.created_at);
        const rightTime = Date.parse(right.job.completed_at ?? right.job.updated_at ?? right.job.created_at);
        return leftTime - rightTime;
      });
      const retentionCutoff = now.getTime() - this.registry.service.jobRetentionDays * 24 * 60 * 60 * 1000;
      const remove = new Set(
        terminalJobs
          .filter(({ job }) => Date.parse(job.completed_at ?? job.updated_at ?? job.created_at) <= retentionCutoff)
          .map(({ job }) => job.job_id),
      );
      const remaining = terminalJobs.filter(({ job }) => !remove.has(job.job_id));
      const excess = Math.max(0, remaining.length - this.registry.service.jobHistoryLimit);
      for (const { job } of remaining.slice(0, excess)) remove.add(job.job_id);

      for (const { job, filePath } of terminalJobs) {
        if (!remove.has(job.job_id)) continue;
        await fs.unlink(filePath).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (job.idempotency_key && job.creator) {
          const indexKey = idempotencyIndexKey(job.creator, job.capability, job.idempotency_key);
          await fs.unlink(path.join(this.idempotencyDir, `${indexKey}.json`)).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      }
      await this.writeActiveJobIds(activeJobIds);
      return { removed: remove.size, retained_terminal: terminalJobs.length - remove.size };
    });
    this.lastCleanupAt = now.getTime();
    return result;
  }

  async maybeCleanup() {
    // active.json 是性能缓存而不是唯一真相；低频扫描 items 可修复进程在
    // “写任务文件 / 写活动索引”之间退出留下的孤儿任务。
    if (Date.now() - this.lastCleanupAt < 30 * 1000) return;
    await this.cleanup();
  }

  async create(input, context = {}) {
    if (!isPlainObject(input)) {
      throw new HttpError(400, 'INVALID_JOB_REQUEST', '任务创建请求必须是 JSON 对象');
    }
    const capability = this.capability(input.capability);
    const creator = normalizeCreator(context.creator);
    const jobInput = Object.prototype.hasOwnProperty.call(input, 'input') ? input.input : {};
    if (!isPlainObject(jobInput)) {
      throw new HttpError(400, 'INVALID_JOB_INPUT', 'input 必须是 JSON 对象');
    }
    if (capability.inputMode === 'none' && Object.keys(jobInput).length > 0) {
      throw new HttpError(400, 'JOB_INPUT_NOT_ALLOWED', '该任务能力不接受自定义 input');
    }
    const inputInfo = requireSize(jobInput, capability.maxInputBytes, 'input');
    const confirmed = input.confirmed === true;
    if (capability.confirmationRequired && !confirmed) {
      throw new HttpError(409, 'CONFIRMATION_REQUIRED', '该任务能力会修改业务数据，创建时必须明确确认');
    }
    const ttlSeconds = input.ttl_seconds === undefined
      ? capability.defaultTtlSeconds
      : Number(input.ttl_seconds);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > capability.maxTtlSeconds) {
      throw new HttpError(
        400,
        'INVALID_JOB_TTL',
        `ttl_seconds 必须是 1 到 ${capability.maxTtlSeconds} 之间的整数`,
      );
    }
    const idempotencyKey = input.idempotency_key === undefined || input.idempotency_key === null
      ? null
      : String(input.idempotency_key);
    if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'idempotency_key 格式无效');
    }
    const requestSha256 = sha256(serializeJson({
      capability: capability.id,
      input: jobInput,
      confirmed,
    }));
    const indexKey = idempotencyKey === null
      ? null
      : idempotencyIndexKey(creator, capability.id, idempotencyKey);

    await this.maybeCleanup();
    return withFileLock(this.lockPath, async () => {
      if (indexKey) {
        const indexPath = path.join(this.idempotencyDir, `${indexKey}.json`);
        try {
          const index = await readJsonFile(indexPath);
          let existing;
          try {
            existing = await this.readJob(index.job_id);
          } catch (error) {
            if (!(error instanceof HttpError) || error.code !== 'JOB_NOT_FOUND') throw error;
            await fs.unlink(indexPath).catch((unlinkError) => {
              if (unlinkError.code !== 'ENOENT') throw unlinkError;
            });
            const activeJobIds = await this.readActiveJobIds();
            if (activeJobIds.delete(index.job_id)) await this.writeActiveJobIds(activeJobIds);
          }
          // 崩溃可能发生在删除历史任务与删除其幂等索引之间；孤儿索引已经在
          // 上面清除，此时继续创建即可，不能让该 key 永久卡死。
          if (existing) {
            if (index.request_sha256 !== requestSha256 || existing.request_sha256 !== requestSha256) {
              throw new HttpError(
                409,
                'IDEMPOTENCY_CONFLICT',
                '相同 idempotency_key 已用于不同的任务输入',
              );
            }
            const current = await this.expireIfNeeded(existing);
            if (!TERMINAL_STATES.has(current.state)) {
              const activeJobIds = await this.readActiveJobIds();
              if (!activeJobIds.has(current.job_id)) {
                activeJobIds.add(current.job_id);
                await this.writeActiveJobIds(activeJobIds);
              }
            }
            return { job: publicJob(current), duplicate: true };
          }
        } catch (error) {
          if (error instanceof HttpError) throw error;
          if (error.code !== 'ENOENT') throw error;
        }
      }

      const now = new Date();
      const jobId = `job-${now.getTime().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
      const createdAt = now.toISOString();
      const job = {
        schema_version: 1,
        job_id: jobId,
        capability: capability.id,
        capability_name: capability.name,
        mode: capability.mode,
        state: 'pending',
        input: jobInput,
        input_bytes: inputInfo.bytes,
        creator,
        idempotency_key: idempotencyKey,
        request_sha256: requestSha256,
        confirmed,
        created_at: createdAt,
        updated_at: createdAt,
        expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
        claimed_at: null,
        claimed_by: null,
        worker_id: null,
        claim_token_sha256: null,
        lease_expires_at: null,
        attempts: 0,
        progress: null,
        result: null,
        error: null,
        completed_at: null,
      };
      if (indexKey) {
        await writeJsonAtomic(path.join(this.idempotencyDir, `${indexKey}.json`), {
          schema_version: 1,
          creator,
          capability: capability.id,
          idempotency_key: idempotencyKey,
          request_sha256: requestSha256,
          job_id: jobId,
          created_at: createdAt,
        });
      }
      // 幂等索引先行：若进程在下一步前退出，重试会通过“孤儿索引”自愈；
      // 反过来先写 item 会留下无法由 idempotency_key 识别的重复任务窗口。
      await writeJsonAtomic(this.itemPath(jobId), job);
      const activeJobIds = await this.readActiveJobIds();
      activeJobIds.add(jobId);
      await this.writeActiveJobIds(activeJobIds);
      return { job: publicJob(job), duplicate: false };
    });
  }

  async get(jobId) {
    return withFileLock(this.lockPath, async () => {
      const job = await this.expireIfNeeded(await this.readJob(parseJobId(jobId)));
      if (TERMINAL_STATES.has(job.state)) {
        const activeJobIds = await this.readActiveJobIds();
        if (activeJobIds.delete(job.job_id)) await this.writeActiveJobIds(activeJobIds);
      }
      return publicJob(job);
    });
  }

  async claim(capabilityIds, clientId, workerId = clientId) {
    const allowed = new Set(capabilityIds);
    if (!allowed.size) return null;
    const normalizedClientId = normalizeCreator({ type: 'client', id: clientId }).id;
    await this.maybeCleanup();
    return withFileLock(this.lockPath, async () => {
      const activeJobIds = await this.readActiveJobIds();
      let activeIndexChanged = false;
      const now = new Date();
      for (const jobId of [...activeJobIds].sort()) {
        let job;
        try {
          job = await this.readJob(jobId);
        } catch (error) {
          if (!(error instanceof HttpError) || error.code !== 'JOB_NOT_FOUND') throw error;
          activeJobIds.delete(jobId);
          activeIndexChanged = true;
          continue;
        }
        job = await this.expireIfNeeded(job, now);
        if (TERMINAL_STATES.has(job.state)) {
          activeJobIds.delete(jobId);
          activeIndexChanged = true;
          continue;
        }
        if (!allowed.has(job.capability)) continue;
        const claimable = job.state === 'pending'
          || (job.state === 'running' && Date.parse(job.lease_expires_at) <= now.getTime());
        if (!claimable) continue;
        const capability = this.capability(job.capability);
        const claimToken = crypto.randomBytes(32).toString('base64url');
        const timestamp = now.toISOString();
        job = {
          ...job,
          state: 'running',
          updated_at: timestamp,
          claimed_at: timestamp,
          claimed_by: normalizedClientId,
          worker_id: workerId,
          claim_token_sha256: sha256(claimToken),
          lease_expires_at: new Date(now.getTime() + capability.leaseSeconds * 1000).toISOString(),
          attempts: Number(job.attempts ?? 0) + 1,
        };
        await writeJsonAtomic(this.itemPath(job.job_id), job);
        if (activeIndexChanged) await this.writeActiveJobIds(activeJobIds);
        return { job: publicJob(job), claim_token: claimToken };
      }
      if (activeIndexChanged) await this.writeActiveJobIds(activeJobIds);
      return null;
    });
  }

  assertClaim(job, clientId, claimToken, now = new Date()) {
    if (TERMINAL_STATES.has(job.state)) {
      if (
        typeof claimToken === 'string'
        && job.claimed_by === clientId
        && safeTokenEquals(claimToken, job.final_claim_token_sha256)
      ) {
        return 'duplicate';
      }
      throw new HttpError(409, 'JOB_ALREADY_FINISHED', '任务已经结束');
    }
    if (
      job.state !== 'running'
      || job.claimed_by !== clientId
      || typeof claimToken !== 'string'
      || !safeTokenEquals(claimToken, job.claim_token_sha256)
      || Date.parse(job.lease_expires_at) <= now.getTime()
    ) {
      throw new HttpError(409, 'CLAIM_LOST', '任务领取凭据无效或租约已经失效');
    }
    return 'active';
  }

  async progress(jobId, clientId, input) {
    if (!isPlainObject(input)) {
      throw new HttpError(400, 'INVALID_JOB_PROGRESS', '进度请求必须是 JSON 对象');
    }
    return withFileLock(this.lockPath, async () => {
      const now = new Date();
      let job = await this.expireIfNeeded(await this.readJob(parseJobId(jobId)), now);
      this.assertClaim(job, clientId, input.claim_token, now);
      const capability = this.capability(job.capability);
      const progress = Object.prototype.hasOwnProperty.call(input, 'progress') ? input.progress : null;
      requireSize(progress, capability.maxProgressBytes, 'progress');
      const timestamp = now.toISOString();
      job = {
        ...job,
        progress,
        updated_at: timestamp,
        lease_expires_at: new Date(now.getTime() + capability.leaseSeconds * 1000).toISOString(),
      };
      await writeJsonAtomic(this.itemPath(job.job_id), job);
      return publicJob(job);
    });
  }

  async complete(jobId, clientId, input) {
    if (!isPlainObject(input)) {
      throw new HttpError(400, 'INVALID_JOB_COMPLETION', '完成请求必须是 JSON 对象');
    }
    const state = input.state;
    if (!['succeeded', 'failed'].includes(state)) {
      throw new HttpError(400, 'INVALID_JOB_COMPLETION', 'state 必须是 succeeded 或 failed');
    }
    return withFileLock(this.lockPath, async () => {
      const now = new Date();
      let job = await this.expireIfNeeded(await this.readJob(parseJobId(jobId)), now);
      const claimState = this.assertClaim(job, clientId, input.claim_token, now);
      if (claimState === 'duplicate') return { job: publicJob(job), duplicate: true };
      const capability = this.capability(job.capability);
      const result = state === 'succeeded'
        ? (Object.prototype.hasOwnProperty.call(input, 'result') ? input.result : null)
        : null;
      const error = state === 'failed'
        ? (isPlainObject(input.error) ? input.error : { code: 'EXECUTION_FAILED', message: '浏览器任务执行失败' })
        : null;
      requireSize(state === 'succeeded' ? result : error, capability.maxResultBytes, state === 'succeeded' ? 'result' : 'error');
      const progress = Object.prototype.hasOwnProperty.call(input, 'progress')
        ? input.progress
        : job.progress;
      requireSize(progress, capability.maxProgressBytes, 'progress');
      const timestamp = now.toISOString();
      job = {
        ...job,
        state,
        result,
        error,
        progress,
        updated_at: timestamp,
        completed_at: timestamp,
        lease_expires_at: null,
        final_claim_token_sha256: job.claim_token_sha256,
        claim_token_sha256: null,
      };
      await writeJsonAtomic(this.itemPath(job.job_id), job);
      const activeJobIds = await this.readActiveJobIds();
      if (activeJobIds.delete(job.job_id)) await this.writeActiveJobIds(activeJobIds);
      return { job: publicJob(job), duplicate: false };
    });
  }
}

module.exports = {
  JobStore,
  TERMINAL_STATES,
};
