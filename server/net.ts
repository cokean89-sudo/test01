// 외부 URL 가져오기 — 사설망/로컬 주소로의 요청을 막고(SSRF 방지) 리다이렉트를 직접 따라간다.

import dns from "node:dns/promises";
import net from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const ALLOW_PRIVATE = process.env.ALLOW_PRIVATE_FETCH === "1";

export class FetchError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
  }
  return false;
}

export function normalizeUrl(raw: string): URL {
  let s = raw.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new FetchError("올바른 URL 이 아니에요: " + raw, 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("http/https 주소만 지원해요", 400);
  return url;
}

async function assertPublic(url: URL): Promise<void> {
  if (ALLOW_PRIVATE) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new FetchError("로컬 주소는 가져올 수 없어요", 400);
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new FetchError("호스트를 찾을 수 없어요: " + host, 400);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new FetchError("사설망 주소는 가져올 수 없어요", 400);
}

export interface SafeFetchInit {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxRedirects?: number;
}

/** 리다이렉트를 한 단계씩 검사하며 따라가는 fetch. 최종 URL 은 response.url 대신 finalUrl 로 돌려준다. */
export async function safeFetch(raw: string | URL, init: SafeFetchInit = {}): Promise<{ res: Response; finalUrl: URL }> {
  let url = typeof raw === "string" ? normalizeUrl(raw) : raw;
  const maxRedirects = init.maxRedirects ?? 5;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublic(url);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? 15000),
      headers: {
        "user-agent": BROWSER_UA,
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        ...init.headers,
      },
    }).catch((err: Error) => {
      throw new FetchError(`가져오기 실패 (${url.hostname}): ${err.message}`);
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }
    return { res, finalUrl: url };
  }
  throw new FetchError("리다이렉트가 너무 많아요");
}

export async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError("파일이 너무 커요", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** 이미지 핫링크 차단을 피하기 위해 원본 사이트를 referer 로 붙여 이미지를 가져온다. */
export async function fetchImage(raw: string, maxBytes = 25 * 1024 * 1024): Promise<{ data: Buffer; type: string }> {
  const url = normalizeUrl(raw);
  const { res } = await safeFetch(url, {
    headers: { accept: "image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5", referer: url.origin + "/" },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new FetchError(`이미지를 가져오지 못했어요 (HTTP ${res.status})`, res.status === 404 ? 404 : 502);
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const data = await readLimited(res, maxBytes);
  const sniffed = sniffImageType(data);
  if (!type.startsWith("image/") && !sniffed) throw new FetchError("이미지 파일이 아니에요", 415);
  return { data, type: sniffed ?? type };
}

export function sniffImageType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const head = buf.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
}
