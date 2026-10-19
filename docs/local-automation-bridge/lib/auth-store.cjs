'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HttpError,
  readJsonFile,
  safeTokenEquals,
  SerialQueue,
  sha256,
  writeJsonAtomic,
} = require('./common.cjs');

class AuthStore {
  constructor(registry, options = {}) {
    this.registry = registry;
    this.stateRoot = registry.service.stateRoot;
    this.staticToken = options.staticToken ? String(options.staticToken) : null;
    this.legacyTokenOverride = options.legacyTokenOverride
      ? String(options.legacyTokenOverride).trim()
      : null;
    this.legacyMigrationPath = registry.stores.lingxing
      ? path.join(registry.stores.lingxing.rootDir, '_config', 'bridge-token.txt')
      : null;
    this.pairQueues = new Map();
  }

  async init() {
    await Promise.all([
      fs.mkdir(path.join(this.stateRoot, 'legacy-tokens'), { recursive: true }),
      fs.mkdir(path.join(this.stateRoot, 'client-auth'), { recursive: true }),
      fs.mkdir(path.join(this.stateRoot, 'pairing'), { recursive: true }),
    ]);
  }

  legacyTokenPath(client) {
    return path.join(this.stateRoot, 'legacy-tokens', `${client.id}.token`);
  }

  authPath(client) {
    return path.join(this.stateRoot, 'client-auth', `${client.id}.json`);
  }

  pairingPath(client) {
    return path.join(this.stateRoot, 'pairing', `${client.id}.json`);
  }

  async getLegacyToken(client) {
    if (client.pairing !== 'legacy_auto') {
      throw new HttpError(403, 'PAIRING_DENIED', '该客户端不允许兼容自动配对');
    }
    if (this.staticToken) return this.staticToken;
    if (this.legacyTokenOverride) {
      if (this.legacyTokenOverride.length < 24) {
        throw new Error('LINGXING_BRIDGE_TOKEN 至少需要 24 个字符');
      }
      return this.legacyTokenOverride;
    }
    const tokenPath = this.legacyTokenPath(client);
    try {
      const token = (await fs.readFile(tokenPath, 'utf8')).trim();
      if (token.length < 24) throw new Error('兼容令牌长度无效');
      return token;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (this.legacyMigrationPath) {
      try {
        const migrated = (await fs.readFile(this.legacyMigrationPath, 'utf8')).trim();
        if (migrated.length >= 24) {
          try {
            await fs.writeFile(tokenPath, `${migrated}\n`, {
              encoding: 'utf8', flag: 'wx', mode: 0o600,
            });
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
            return (await fs.readFile(tokenPath, 'utf8')).trim();
          }
          return migrated;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const token = crypto.randomBytes(32).toString('base64url');
    try {
      await fs.writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return token;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return (await fs.readFile(tokenPath, 'utf8')).trim();
    }
  }

  async issuePairCode(client, ttlMs = 10 * 60 * 1000) {
    if (client.pairing !== 'code') {
      throw new Error(`客户端 ${client.id} 不使用一次性配对码`);
    }
    const code = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await writeJsonAtomic(this.pairingPath(client), {
      schema_version: 1,
      client_id: client.id,
      code_sha256: sha256(code),
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
    return { code, expiresAt: expiresAt.toISOString() };
  }

  async consumePairCodeOnce(client, code, instanceId = null) {
    if (client.pairing !== 'code') {
      throw new HttpError(403, 'PAIRING_DENIED', '该客户端未启用配对码');
    }
    if (typeof code !== 'string' || code.length < 24 || code.length > 256) {
      throw new HttpError(403, 'INVALID_PAIRING_CODE', '配对码无效');
    }
    const pairPath = this.pairingPath(client);
    let record;
    try {
      record = await readJsonFile(pairPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HttpError(403, 'PAIRING_CODE_REQUIRED', '请先用本地 CLI 生成一次性配对码');
      }
      throw error;
    }
    if (
      !record
      || record.client_id !== client.id
      || Date.parse(record.expires_at) <= Date.now()
      || !safeTokenEquals(code, record.code_sha256)
    ) {
      throw new HttpError(403, 'INVALID_PAIRING_CODE', '配对码无效或已过期');
    }

    const claimedPath = `${pairPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.used`;
    try {
      await fs.rename(pairPath, claimedPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new HttpError(409, 'PAIRING_CODE_USED', '配对码已经被使用');
      }
      throw error;
    }

    try {
      const token = this.staticToken ?? crypto.randomBytes(32).toString('base64url');
      const issuedAt = new Date().toISOString();
      await writeJsonAtomic(this.authPath(client), {
        schema_version: 1,
        client_id: client.id,
        instance_id: typeof instanceId === 'string' ? instanceId.slice(0, 128) : null,
        token_sha256: sha256(token),
        issued_at: issuedAt,
        revoked_at: null,
      });
      return { token, issuedAt };
    } finally {
      await fs.unlink(claimedPath).catch(() => undefined);
    }
  }

  consumePairCode(client, code, instanceId = null) {
    let queue = this.pairQueues.get(client.id);
    if (!queue) {
      queue = new SerialQueue();
      this.pairQueues.set(client.id, queue);
    }
    return queue.run(() => this.consumePairCodeOnce(client, code, instanceId));
  }

  async authenticate(client, token) {
    if (!client || typeof token !== 'string' || token.length < 1) return false;
    if (this.staticToken) return safeTokenEquals(token, sha256(this.staticToken));
    if (client.pairing === 'legacy_auto') {
      const expected = await this.getLegacyToken(client);
      return safeTokenEquals(token, sha256(expected));
    }
    try {
      const record = await readJsonFile(this.authPath(client));
      return Boolean(
        record
        && record.client_id === client.id
        && !record.revoked_at
        && safeTokenEquals(token, record.token_sha256),
      );
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}

module.exports = { AuthStore };
