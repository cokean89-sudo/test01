// 보안 기본 요소: 비밀번호 해시, 토큰, 요청 제한, 쿠키, CSRF·Origin 검사, 보안 헤더

import crypto from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import helmet from "helmet";
import { APP_ORIGIN, isProd, SECURE_COOKIES } from "./config";

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// ─── 비밀번호 (scrypt, 사용자별 salt) ─────────────────────────

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // 계정 유무를 응답 시간으로 알 수 없도록 같은 비용의 연산을 한다
    await scrypt(password, crypto.randomBytes(16), 32, SCRYPT);
    return false;
  }
  const [alg, n, r, p, saltB64, hashB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "qwertyuiop",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "iloveyou",
  "admin1234",
  "asdf1234",
  "qwer1234",
  "abcd1234",
]);

export const isCommonPassword = (pw: string) => COMMON.has(pw.toLowerCase());

/** 비밀번호 정책 — 통과하면 null */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 10) return "비밀번호는 10자 이상이어야 해요.";
  if (password.length > 200) return "비밀번호가 너무 길어요.";
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (kinds < 2) return "영문 대/소문자, 숫자, 특수문자 중 두 종류 이상을 섞어 주세요.";
  if (COMMON.has(password.toLowerCase())) return "너무 흔한 비밀번호예요.";
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) {
    return "비밀번호에 메일 아이디를 넣지 마세요.";
  }
  return null;
}

// ─── 토큰 ───────────────────────────────────────────────────

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0/O, 1/I 제외
export function randomCode(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ─── 요청 제한 (고정 창) ────────────────────────────────────────

export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor() {
    setInterval(() => {
      const t = Date.now();
      for (const [k, v] of this.hits) if (v.reset < t) this.hits.delete(k);
    }, 60_000).unref();
  }

  /** limit 초과 시 { ok: false, retryAfter(초) } */
  hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
    const t = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.reset < t) {
      this.hits.set(key, { count: 1, reset: t + windowMs });
      return { ok: true, retryAfter: 0 };
    }
    cur.count++;
    return cur.count > limit ? { ok: false, retryAfter: Math.ceil((cur.reset - t) / 1000) } : { ok: true, retryAfter: 0 };
  }

  reset(key: string) {
    this.hits.delete(key);
  }

  /** 테스트용 */
  clear() {
    this.hits.clear();
  }
}

export const limiter = new RateLimiter();

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

/** 키 하나에 대해 요청 제한 — 초과하면 429 */
export function enforceLimit(key: string, limit: number, windowMs: number, message = "요청이 너무 많아요. 잠시 후 다시 시도하세요.") {
  const r = limiter.hit(key, limit, windowMs);
  if (!r.ok) throw new HttpError(429, message, "rate_limited", { "retry-after": String(r.retryAfter) });
}

/** 미들웨어 형태 요청 제한 (IP 기준) */
export function rateLimit(name: string, limit: number, windowMs: number): RequestHandler {
  return (req, _res, next) => {
    enforceLimit(`${name}:${req.ip}`, limit, windowMs);
    next();
  };
}

// ─── 쿠키 ───────────────────────────────────────────────────

export const SESSION_COOKIE = SECURE_COOKIES ? "__Host-rb_session" : "rb_session";
export const OAUTH_COOKIE = SECURE_COOKIES ? "__Host-rb_oauth" : "rb_oauth";

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (!(k in out)) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function setCookie(res: Response, name: string, value: string, maxAgeSec: number) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`];
  if (SECURE_COOKIES) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearCookie(res: Response, name: string) {
  setCookie(res, name, "", 0);
}

// ─── CSRF / Origin 검사 ───────────────────────────────────────

/**
 * 상태를 바꾸는 API 요청(POST/PUT/PATCH/DELETE)에
 * 1) 사용자 정의 헤더 x-refboard: 1 (다른 사이트의 폼·단순 요청으로는 붙일 수 없음)
 * 2) Origin 이 있으면 APP_URL 또는 요청 호스트와 같은지
 * 를 요구한다. 세션 쿠키는 SameSite=Lax 로 한 번 더 막힌다.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-refboard") !== "1") throw new HttpError(403, "잘못된 요청이에요 (CSRF 헤더 없음).", "csrf");
  const origin = req.get("origin");
  if (origin && origin !== APP_ORIGIN && origin !== `${req.protocol}://${req.get("host")}`) {
    throw new HttpError(403, "허용되지 않은 출처의 요청이에요.", "origin");
  }
  const site = req.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "허용되지 않은 출처의 요청이에요.", "origin");
  next();
}

// ─── 보안 헤더 ───────────────────────────────────────────────

export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: isProd
      ? {
          useDefaults: false,
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
            // 레퍼런스 이미지는 외부 링크를 그대로 표시한다
            imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            ...(SECURE_COOKIES ? { upgradeInsecureRequests: [] } : {}),
          },
        }
      : false, // 개발 모드는 Vite HMR 때문에 CSP 끔
    crossOriginEmbedderPolicy: false, // 외부 이미지 표시
    crossOriginResourcePolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    strictTransportSecurity: SECURE_COOKIES ? { maxAge: 31536000, includeSubDomains: true } : false,
    frameguard: { action: "deny" },
  });
}

export function permissionsPolicy(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
}

export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
