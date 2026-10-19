'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HttpError,
  isPlainObject,
  readJsonFile,
  serializeJson,
  sha256,
  withFileLock,
  writeJsonAtomic,
} = require('./common.cjs');

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 64 || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'INVALID_CONFIG_PUBLICATION', `${fieldName} 必须是有效日期`);
  }
  return new Date(value).toISOString();
}

function normalizePublicationId(value) {
  const id = value ?? crypto.randomUUID();
  const firstSegment = typeof id === 'string' ? id.split('.')[0].toUpperCase() : '';
  if (
    typeof id !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(id)
    || id.endsWith('.')
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(firstSegment)
  ) {
    throw new HttpError(400, 'INVALID_PUBLICATION_ID', 'publication_id 格式无效');
  }
  return id;
}

async function readCurrent(definition, options = {}) {
  const currentPath = path.join(definition.resourcePath, 'current.json');
  let document;
  try {
    document = await readJsonFile(currentPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new HttpError(404, 'CONFIG_NOT_PUBLISHED', `配置 ${definition.id} 尚未发布`);
    }
    throw error;
  }
  if (!isPlainObject(document) || document.resource_id !== definition.id) {
    throw new Error(`配置 ${definition.id} 的 current.json 结构无效`);
  }
  if (!options.allowExpired && document.expires_at && Date.parse(document.expires_at) <= Date.now()) {
    throw new HttpError(410, 'CONFIG_EXPIRED', `配置 ${definition.id} 已过期`);
  }
  return document;
}

async function publishConfigUnlocked(definition, input, context = {}) {
  if (!isPlainObject(input)) {
    throw new HttpError(400, 'INVALID_CONFIG_PUBLICATION', '配置发布请求必须是 JSON 对象');
  }
  const isEnvelope = Object.prototype.hasOwnProperty.call(input, 'data');
  const data = isEnvelope ? input.data : input;
  const publicationId = normalizePublicationId(isEnvelope ? input.publication_id : undefined);
  const expectedRevision = isEnvelope
    && Object.prototype.hasOwnProperty.call(input, 'expected_current_revision')
    ? input.expected_current_revision
    : undefined;
  if (expectedRevision !== undefined && expectedRevision !== null && typeof expectedRevision !== 'string') {
    throw new HttpError(
      400,
      'INVALID_CONFIG_PUBLICATION',
      'expected_current_revision 必须是字符串或 null',
    );
  }
  const effectiveAt = normalizeDate(isEnvelope ? input.effective_at : null, 'effective_at');
  const expiresAt = normalizeDate(isEnvelope ? input.expires_at : null, 'expires_at');
  if (effectiveAt && expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveAt)) {
    throw new HttpError(400, 'INVALID_CONFIG_PUBLICATION', 'expires_at 必须晚于 effective_at');
  }

  const dataText = serializeJson(data);
  const dataBytes = Buffer.byteLength(dataText);
  if (dataBytes > definition.maxBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `配置数据超过 ${definition.maxBytes} 字节限制`);
  }
  const dataSha256 = sha256(dataText);
  const versionsDir = path.join(definition.resourcePath, 'versions');
  const versionPath = path.join(versionsDir, `${publicationId}.json`);
  const currentPath = path.join(definition.resourcePath, 'current.json');
  const statusPath = path.join(definition.resourcePath, 'status.json');
  await fs.mkdir(versionsDir, { recursive: true });

  let current = null;
  try {
    current = await readCurrent(definition, { allowExpired: true });
  } catch (error) {
    if (!(error instanceof HttpError) || error.code !== 'CONFIG_NOT_PUBLISHED') throw error;
  }
  const source = isEnvelope && isPlainObject(input.source) ? input.source : {};
  const publicationSha256 = sha256(serializeJson({
    schema_version: 1,
    resource_id: definition.id,
    publication_id: publicationId,
    expected_revision_provided: expectedRevision !== undefined,
    expected_current_revision: expectedRevision ?? null,
    effective_at: effectiveAt,
    expires_at: expiresAt,
    source,
    data,
  }));

  const writeStatus = (document) => writeJsonAtomic(statusPath, {
    schema_version: 1,
    resource_id: definition.id,
    state: 'published',
    current_revision: document.revision,
    publication_id: document.publication_id,
    published_at: document.published_at,
    effective_at: document.effective_at,
    expires_at: document.expires_at,
    data_sha256: document.data_sha256,
    publication_sha256: document.publication_sha256,
    current_file: 'current.json',
    version_file: `versions/${document.publication_id}.json`,
  });

  // 版本文件可能已写成、但 current/status 尚未写成。原请求重试时要完成提交，
  // 不能仅返回 duplicate；若 current 已经前进，则拒绝回滚。
  try {
    const existingVersion = await readJsonFile(versionPath);
    if (existingVersion.publication_sha256 !== publicationSha256) {
      throw new HttpError(409, 'PUBLICATION_ID_CONFLICT', '相同 publication_id 已发布过不同内容或元数据');
    }
    const currentRevision = current?.revision ?? null;
    if (currentRevision !== existingVersion.revision) {
      if (currentRevision !== (existingVersion.base_revision ?? null)) {
        throw new HttpError(409, 'REVISION_CONFLICT', '配置已前进，不能恢复旧 publication');
      }
      await writeJsonAtomic(currentPath, existingVersion);
    }
    await writeStatus(existingVersion);
    return { document: existingVersion, duplicate: true, recovered: currentRevision !== existingVersion.revision };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error.code !== 'ENOENT') throw error;
  }

  if (expectedRevision !== undefined && expectedRevision !== (current?.revision ?? null)) {
    throw new HttpError(409, 'REVISION_CONFLICT', 'expected_current_revision 与当前配置版本不一致');
  }

  const publishedAt = new Date().toISOString();
  const revision = `${publishedAt.replace(/[-:.TZ]/g, '').slice(0, 17)}-${dataSha256.slice(0, 16)}`;
  const document = {
    schema_version: 1,
    resource_id: definition.id,
    resource_name: definition.name,
    publication_id: publicationId,
    revision,
    base_revision: current?.revision ?? null,
    published_at: publishedAt,
    effective_at: effectiveAt,
    expires_at: expiresAt,
    data_sha256: dataSha256,
    publication_sha256: publicationSha256,
    data_bytes: dataBytes,
    source: {
      ...source,
      bridge_client_id: context.clientId ?? source.bridge_client_id ?? 'local-cli',
      via: context.via ?? source.via ?? 'local-cli',
    },
    data,
  };

  await writeJsonAtomic(versionPath, document);
  await writeJsonAtomic(currentPath, document);
  await writeStatus(document);
  return { document, duplicate: false, recovered: false };
}

async function publishConfig(definition, input, context = {}) {
  return withFileLock(
    path.join(definition.resourcePath, '.publish.lock'),
    () => publishConfigUnlocked(definition, input, context),
  );
}

module.exports = { publishConfig, readCurrent };
