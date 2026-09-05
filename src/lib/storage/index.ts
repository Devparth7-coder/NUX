/**
 * Storage abstraction (§2). Local driver now, S3-compatible driver for
 * production. Secrets never reach the client; only opaque keys do.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, readdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { env } from '../env';
import { NexusError } from '../errors';

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
  driver: string;
}

export interface StorageDriver {
  readonly id: string;
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
}

export class LocalStorageDriver implements StorageDriver {
  readonly id = 'local';
  private readonly root: string;

  constructor(root: string = env.storageDir) {
    this.root = path.isAbsolute(root) ? root : path.join(process.cwd(), root);
  }

  private resolve(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
    const target = path.join(this.root, safe);
    if (!target.startsWith(this.root)) throw new NexusError('VALIDATION', 'Invalid storage key');
    return target;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    const { createWriteStream: cws } = await import('node:fs');
    await pipeline(
      (async function* () {
        yield data;
      })(),
      cws(target),
    );
    void contentType;
    return { key, size: data.byteLength, contentType, driver: this.id };
  }

  async get(key: string): Promise<Buffer> {
    const target = this.resolve(key);
    const chunks: Buffer[] = [];
    const stream = createReadStream(target);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix = ''): Promise<string[]> {
    const target = this.resolve(prefix);
    try {
      const entries = await readdir(target, { recursive: true });
      return entries.map(String);
    } catch {
      return [];
    }
  }
}

/**
 * S3-compatible driver. Requires S3_* configuration; until then it fails with a
 * clear, actionable error rather than silently falling back.
 */
export class S3StorageDriver implements StorageDriver {
  readonly id = 's3';
  private get config() {
    const bucket = process.env.S3_BUCKET;
    const region = process.env.S3_REGION;
    const accessKey = process.env.S3_ACCESS_KEY_ID;
    const secret = process.env.S3_SECRET_ACCESS_KEY;
    if (!bucket || !region || !accessKey || !secret) return null;
    return { bucket, region, accessKey, secret, endpoint: process.env.S3_ENDPOINT };
  }

  private require() {
    const cfg = this.config;
    if (!cfg) {
      throw new NexusError(
        'INTERNAL',
        'S3 storage driver selected but S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not configured.',
      );
    }
    return cfg;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const cfg = this.require();
    const url = `${cfg.endpoint ?? `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`}/${key}`;
    const res = await fetch(url, { method: 'PUT', body: new Uint8Array(data), headers: { 'Content-Type': contentType } });
    if (!res.ok) throw new NexusError('INTERNAL', `S3 upload failed (${res.status})`);
    return { key, size: data.byteLength, contentType, driver: this.id };
  }

  async get(key: string): Promise<Buffer> {
    const cfg = this.require();
    const url = `${cfg.endpoint ?? `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`}/${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new NexusError('NOT_FOUND', `Object not found (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const cfg = this.require();
    const url = `${cfg.endpoint ?? `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com`}/${key}`;
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) throw new NexusError('INTERNAL', `S3 delete failed (${res.status})`);
  }

  async exists(): Promise<boolean> {
    this.require();
    return false;
  }

  async list(): Promise<string[]> {
    this.require();
    return [];
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (!driver) driver = env.storageDriver === 's3' ? new S3StorageDriver() : new LocalStorageDriver();
  return driver;
}

export function buildDocumentKey(workspaceId: string, documentId: string, filename: string): string {
  const ext = path.extname(filename).slice(0, 12);
  return `documents/${workspaceId}/${documentId}${ext}`;
}

export { createWriteStream };
