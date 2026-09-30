// 파일 저장소 — 올린 이미지를 어디에 둘지 한 곳에서 정한다.
//
//   STORAGE_DRIVER=disk (기본)  DATA_DIR/uploads (또는 UPLOADS_DIR) 에 저장 — Render 디스크
//   STORAGE_DRIVER=s3           S3 호환 저장소 (Cloudflare R2, AWS S3, MinIO …)
//     S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (비밀), S3_REGION (R2 는 auto),
//     S3_ENDPOINT (R2: https://<계정ID>.r2.cloudflarestorage.com, AWS 는 비워 둠), S3_FORCE_PATH_STYLE
//
// 앱 안의 이미지 주소는 저장소와 상관없이 /api/files/<id>.webp 이고 서버가 권한을 확인한 뒤 여기서 읽어 준다.
// 그래서 저장소를 바꿔도(환경변수 + npm run storage:migrate) 레퍼런스 · 문서에 들어 있는 주소는 그대로다.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface StoredObject {
  data: Buffer;
  contentType: string;
}

export interface FileStore {
  readonly kind: "disk" | "s3";
  /** 사람이 읽을 위치 (로그 · 관리 화면) */
  readonly where: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** 남은 공간(바이트) — 알 수 없으면(S3) null */
  freeBytes(): Promise<number | null>;
}

/** 키는 팀ID/파일이름 형태만 — ../ 같은 경로 조작 차단 */
export function assertKey(key: string): string {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)*)+$/.test(key) || key.length > 200) throw new Error("잘못된 저장소 키: " + key);
  return key;
}

const TYPE_BY_EXT: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };
const typeOf = (key: string) => TYPE_BY_EXT[key.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

// ─── 디스크 ────────────────────────────────────────────────

export class DiskStore implements FileStore {
  readonly kind = "disk" as const;
  constructor(readonly dir: string) {}
  get where() {
    return this.dir;
  }

  private file(key: string) {
    const p = path.resolve(this.dir, assertKey(key));
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("저장소 밖 경로");
    return p;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const p = this.file(key);
    await fs.promises.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    // 쓰는 도중 서버가 꺼져도 반쯤 쓴 파일이 남지 않게: 임시 파일에 쓰고 이름만 바꾼다
    const tmp = `${p}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.promises.writeFile(tmp, data, { mode: 0o600 });
    await fs.promises.rename(tmp, p);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      return { data: await fs.promises.readFile(this.file(key)), contentType: typeOf(key) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.promises.rm(this.file(key), { force: true });
  }

  async freeBytes(): Promise<number | null> {
    try {
      await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
      const s = await fs.promises.statfs(this.dir);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  }
}

// ─── S3 호환 (Cloudflare R2 · AWS S3) — SDK 없이 서명 V4 ───────────

const sha256 = (data: string | Buffer) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data).digest();
/** RFC 3986 — S3 는 경로의 / 를 그대로 둔다 */
const encodePath = (p: string) =>
  p
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()))
    .join("/");

export interface SignInput {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  date?: Date;
}

/** AWS Signature Version 4 — 서명된 헤더(authorization, x-amz-date, x-amz-content-sha256 포함)를 돌려준다 */
export function signV4(input: SignInput): Record<string, string> {
  const service = input.service ?? "s3";
  const amzDate = (input.date ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: input.url.host, "x-amz-date": amzDate, "x-amz-content-sha256": input.payloadHash };
  const names = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalRequest = [input.method, encodePath(decodeURIComponent(input.url.pathname)), query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + input.secretAccessKey, day), input.region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(stringToSign).digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}

export interface S3Options {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** 비우면 AWS (https://s3.<region>.amazonaws.com) */
  endpoint?: string;
  /** 경로 방식(https://endpoint/bucket/key). R2 · MinIO 는 기본 true */
  forcePathStyle?: boolean;
}

export class S3Store implements FileStore {
  readonly kind = "s3" as const;
  constructor(private o: S3Options) {}
  get where() {
    return `s3://${this.o.bucket}${this.o.endpoint ? ` (${new URL(this.o.endpoint).host})` : ""}`;
  }

  objectUrl(key: string): URL {
    const k = encodePath(assertKey(key));
    const base = new URL(this.o.endpoint || `https://s3.${this.o.region}.amazonaws.com`);
    const pathStyle = this.o.forcePathStyle ?? !!this.o.endpoint;
    if (pathStyle) return new URL(`${base.origin}${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(this.o.bucket)}/${k}`);
    return new URL(`${base.protocol}//${this.o.bucket}.${base.host}/${k}`);
  }

  private async send(method: string, key: string, body?: Buffer, extra: Record<string, string> = {}) {
    const url = this.objectUrl(key);
    const headers = signV4({
      method,
      url,
      headers: extra,
      payloadHash: sha256(body ?? ""),
      accessKeyId: this.o.accessKeyId,
      secretAccessKey: this.o.secretAccessKey,
      region: this.o.region,
    });
    return fetch(url, { method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(30_000) });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, data, { "content-type": contentType });
    if (!res.ok) throw new Error(`저장소에 올리지 못했어요 (S3 ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  async get(key: string): Promise<StoredObject | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`저장소에서 읽지 못했어요 (S3 ${res.status})`);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || typeOf(key) };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`저장소에서 지우지 못했어요 (S3 ${res.status})`);
  }

  async freeBytes(): Promise<number | null> {
    return null;
  }
}

// ─── 환경변수로 고르기 ───────────────────────────────────────

export function createStore(env: NodeJS.ProcessEnv, dataDir: string): FileStore {
  const driver = (env.STORAGE_DRIVER || "disk").toLowerCase();
  if (driver === "disk") return new DiskStore(env.UPLOADS_DIR ? path.resolve(env.UPLOADS_DIR) : path.join(dataDir, "uploads"));
  if (driver === "s3" || driver === "r2") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=${driver} 인데 ${missing.join(", ")} 가 없어요.`);
    return new S3Store({
      bucket: env.S3_BUCKET!,
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      region: env.S3_REGION || (driver === "r2" ? "auto" : "us-east-1"),
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE ? ["1", "true", "yes"].includes(env.S3_FORCE_PATH_STYLE.toLowerCase()) : undefined,
    });
  }
  throw new Error(`알 수 없는 STORAGE_DRIVER: ${driver} (disk 또는 s3)`);
}
