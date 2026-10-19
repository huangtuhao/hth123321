'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

class SerialQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(operation) {
    const result = this.tail.then(operation, operation);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parsePositiveInteger(value, fallback, name, options = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  const minimum = options.minimum ?? 1;
  const maximum = options.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeTokenEquals(actual, expectedHash) {
  const actualHash = Buffer.from(sha256(actual ?? ''), 'hex');
  const expected = /^[a-f0-9]{64}$/i.test(expectedHash ?? '')
    ? Buffer.from(expectedHash, 'hex')
    : Buffer.alloc(32);
  return crypto.timingSafeEqual(actualHash, expected);
}

function serializeJson(value) {
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch (error) {
    throw new HttpError(400, 'UNSERIALIZABLE_PAYLOAD', `JSON 无法序列化：${error.message}`);
  }
}

async function writeBufferAtomic(targetPath, buffer) {
  const targetDir = path.dirname(targetPath);
  await fs.mkdir(targetDir, { recursive: true });
  const temporaryPath = path.join(
    targetDir,
    `.${path.basename(targetPath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', 0o600);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { bytes: buffer.length, sha256: sha256(buffer) };
}

async function writeTextAtomic(targetPath, text) {
  return writeBufferAtomic(targetPath, Buffer.from(text, 'utf8'));
}

async function writeJsonAtomic(targetPath, value) {
  return writeTextAtomic(targetPath, serializeJson(value));
}

async function readJsonFile(targetPath, fallback = undefined) {
  try {
    const value = JSON.parse(await fs.readFile(targetPath, 'utf8'));
    return value;
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

async function withFileLock(lockPath, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const staleMs = options.staleMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  let handle = null;
  while (!handle) {
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      await handle.sync();
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw new HttpError(423, 'RESOURCE_BUSY', '资源正在由另一个本地进程更新，请稍后重试');
      }
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.floor(Math.random() * 50)));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.unlink(lockPath).catch(() => undefined);
  }
}

function fileTimestamp(date = new Date()) {
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '-',
    pad(date.getMilliseconds(), 3),
  ].join('');
}

function toPosixRelative(rootDir, targetPath) {
  return path.relative(rootDir, targetPath).split(path.sep).join('/');
}

function assertSafeId(value, fieldName = 'id') {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value)) {
    throw new Error(`${fieldName} 只能包含字母、数字、点、下划线和连字符`);
  }
  const firstSegment = value.split('.')[0].toUpperCase();
  if (
    value.endsWith('.')
    || value === '__proto__'
    || value === 'prototype'
    || value === 'constructor'
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(firstSegment)
  ) {
    throw new Error(`${fieldName} 使用了保留名称`);
  }
  return value;
}

function resolveContainedPath(rootDir, relativePath, fieldName = '路径') {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`${fieldName} 必须是非空相对路径`);
  }
  const normalizedRoot = path.resolve(rootDir);
  const candidate = path.resolve(normalizedRoot, relativePath);
  const relative = path.relative(normalizedRoot, candidate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} 不能离开已注册的数据根目录`);
  }
  return candidate;
}

function sanitizeFilename(value) {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_FILENAME', '文件名不能为空');
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 180 || trimmed !== path.basename(trimmed) || /[\\/:*?"<>|\x00-\x1f]/.test(trimmed)) {
    throw new HttpError(400, 'INVALID_FILENAME', '文件名包含路径或 Windows 不允许的字符');
  }
  if (/[. ]$/.test(trimmed)) {
    throw new HttpError(400, 'INVALID_FILENAME', '文件名不能以点或空格结尾');
  }
  const base = path.parse(trimmed).name.toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base)) {
    throw new HttpError(400, 'INVALID_FILENAME', '文件名使用了 Windows 保留设备名');
  }
  return trimmed;
}

async function readRequestBuffer(request, maxBodyBytes) {
  const contentEncoding = request.headers['content-encoding'];
  if (contentEncoding && contentEncoding !== 'identity') {
    throw new HttpError(415, 'UNSUPPORTED_ENCODING', '不接受压缩请求体');
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytesRead = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.on('data', (chunk) => {
      if (settled) return;
      bytesRead += chunk.length;
      if (bytesRead > maxBodyBytes) {
        fail(new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求体超过大小限制'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    request.on('aborted', () => fail(new HttpError(400, 'REQUEST_ABORTED', '请求被中断')));
    request.on('error', fail);
  });
}

function parseJsonBuffer(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', '请求体不是有效 JSON');
  }
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const text = serializeJson(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(text);
}

function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

module.exports = {
  HttpError,
  SerialQueue,
  assertSafeId,
  fileTimestamp,
  isLoopbackRequest,
  isPlainObject,
  parseJsonBuffer,
  parsePositiveInteger,
  readJsonFile,
  readRequestBuffer,
  resolveContainedPath,
  safeTokenEquals,
  sanitizeFilename,
  sendJson,
  serializeJson,
  sha256,
  toPosixRelative,
  withFileLock,
  writeBufferAtomic,
  writeJsonAtomic,
  writeTextAtomic,
};
