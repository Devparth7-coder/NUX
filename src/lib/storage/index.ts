import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

export interface StoredObject {
  key: string;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  readonly id: string;
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  describe(): { id: string; label: string; configured: boolean };
}

class LocalDriver implements StorageDriver {
  readonly id = "local";
  private root = path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

  private resolve(key: string) {
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    const full = path.join(this.root, safe);
    if (!full.startsWith(this.root)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await new Promise<void>((resolve, reject) => {
      const ws = createWriteStream(full);
      ws.on("error", reject);
      ws.on("finish", () => resolve());
      ws.end(data);
    });
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    const full = this.resolve(key);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(full);
      rs.on("data", (c) => chunks.push(Buffer.from(c)));
      rs.on("error", reject);
      rs.on("end", () => resolve());
    });
    return Buffer.concat(chunks);
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string) {
    try {
      await stat(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  describe() {
    return { id: this.id, label: `Local filesystem (${env.STORAGE_LOCAL_DIR})`, configured: true };
  }
}

class S3Driver implements StorageDriver {
  readonly id = "s3";
  async put(): Promise<StoredObject> {
    throw new Error("S3 driver is not configured. Set STORAGE_DRIVER=local or provide S3 credentials.");
  }
  async get(): Promise<Buffer> {
    throw new Error("S3 driver is not configured.");
  }
  async delete(): Promise<void> {
    throw new Error("S3 driver is not configured.");
  }
  async exists(): Promise<boolean> {
    return false;
  }
  describe() {
    return { id: this.id, label: `S3 (${env.S3_BUCKET || "unconfigured"})`, configured: Boolean(env.S3_BUCKET) };
  }
}

const drivers: Record<string, StorageDriver> = { local: new LocalDriver(), s3: new S3Driver() };

export function storage(): StorageDriver {
  const driver = drivers[env.STORAGE_DRIVER] ?? drivers.local;
  if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
    log.warn("STORAGE_DRIVER=s3 but S3_BUCKET is empty — falling back to local driver");
    return drivers.local;
  }
  return driver;
}

export function buildStorageKey(workspaceId: string, kind: string, filename: string) {
  const stamp = Date.now().toString(36);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${workspaceId}/${kind}/${stamp}-${safe}`;
}
