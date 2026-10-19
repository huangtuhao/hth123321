'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  HttpError,
  readJsonFile,
  sanitizeFilename,
  sha256,
  toPosixRelative,
  writeBufferAtomic,
  writeJsonAtomic,
} = require('./common.cjs');

async function uploadArtifact(definition, input, context = {}) {
  if (!Buffer.isBuffer(input)) throw new TypeError('artifact input 必须是 Buffer');
  if (input.length > definition.maxBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `文件超过 ${definition.maxBytes} 字节限制`);
  }
  const filename = sanitizeFilename(context.filename);
  const extension = path.extname(filename).toLowerCase();
  if (definition.allowedExtensions.length && !definition.allowedExtensions.includes(extension)) {
    throw new HttpError(415, 'EXTENSION_NOT_ALLOWED', `不允许上传 ${extension || '无扩展名'} 文件`);
  }
  const now = new Date();
  const dateFolder = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const targetDir = path.join(definition.resourcePath, dateFolder);
  await fs.mkdir(targetDir, { recursive: true });
  const digest = sha256(input);
  let targetPath = path.join(targetDir, filename);
  let duplicate = false;
  try {
    const existing = await fs.readFile(targetPath);
    if (sha256(existing) === digest) {
      duplicate = true;
    } else {
      const parsed = path.parse(filename);
      targetPath = path.join(targetDir, `${parsed.name}-${digest.slice(0, 12)}${parsed.ext}`);
      try {
        const hashedExisting = await fs.readFile(targetPath);
        if (sha256(hashedExisting) === digest) {
          duplicate = true;
        } else {
          targetPath = path.join(targetDir, `${parsed.name}-${digest}${parsed.ext}`);
        }
      } catch (hashedError) {
        if (hashedError.code !== 'ENOENT') throw hashedError;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!duplicate) await writeBufferAtomic(targetPath, input);

  const artifactId = `${definition.id}-${digest.slice(0, 24)}`;
  const metadataPath = path.join(targetDir, `.${path.basename(targetPath)}.metadata.json`);
  const metadata = {
    schema_version: 1,
    artifact_id: artifactId,
    bucket_id: definition.id,
    original_filename: filename,
    stored_filename: path.basename(targetPath),
    media_type: context.mediaType ?? 'application/octet-stream',
    size_bytes: input.length,
    sha256: digest,
    uploaded_at: now.toISOString(),
    client_id: context.clientId ?? null,
    related_to: context.relatedTo ?? null,
  };
  let storedMetadata = metadata;
  if (duplicate) {
    try {
      storedMetadata = await readJsonFile(metadataPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeJsonAtomic(metadataPath, metadata);
    }
  } else {
    await writeJsonAtomic(metadataPath, metadata);
  }
  return {
    ...storedMetadata,
    duplicate,
    store_root: definition.rootDir,
    relative_path: toPosixRelative(definition.rootDir, targetPath),
  };
}

module.exports = { uploadArtifact };
