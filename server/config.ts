// 환경 설정 — 모든 값은 .env / 환경변수로 바꿀 수 있다.

import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = process.env;
const flag = (v: string | undefined, def = false) => (v === undefined || v === "" ? def : ["1", "true", "yes", "on"].includes(v.toLowerCase()));
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const isProd = env.NODE_ENV === "production" || process.argv.includes("--prod");
export const openOnStart = process.argv.includes("--open") || flag(env.OPEN_BROWSER);

export const PORT = Number(env.PORT) || 5178;
export const HOST = env.HOST || "127.0.0.1";
/**
 * 외부에서 접속하는 주소 (메일 링크, 소셜 로그인 콜백, Origin 검사에 사용).
 * Render 에서는 비워 두면 Render 가 알려주는 서비스 주소(https://….onrender.com)를 쓴다.
 */
export const APP_URL = (env.APP_URL || env.RENDER_EXTERNAL_URL || `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`).replace(/\/+$/, "");
export const APP_ORIGIN = new URL(APP_URL).origin;
const isLoopback = (host: string) => ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.toLowerCase());
/** 이 컴퓨터에서만 접속 가능한 개인 실행 (외부 공개 아님) */
export const LOCAL_ONLY = isLoopback(HOST) && isLoopback(new URL(APP_URL).hostname);
/** https 로 서비스하면 쿠키에 Secure·__Host- 를 붙인다 */
export const SECURE_COOKIES = APP_URL.startsWith("https://");
/** 리버스 프록시(Nginx, Caddy, 로드밸런서) 뒤에서 실행할 때 프록시 단계 수 또는 true */
export const TRUST_PROXY = env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : flag(env.TRUST_PROXY)) : false;

export const DATA_DIR = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, "data");

export const auth = {
  /** 메일 가입 허용 여부 (false 면 초대받은 사람·소셜 로그인만) */
  allowSignup: flag(env.ALLOW_SIGNUP, true),
  /** 가입 가능한 메일 도메인 제한 (예: shinsegae.com,emart.com). 비우면 제한 없음 */
  signupDomains: list(env.SIGNUP_EMAIL_DOMAINS),
  sessionDays: Number(env.SESSION_DAYS) || 14,
  /** 세션 최대 수명 (활동과 무관하게 이 기간이 지나면 다시 로그인) */
  sessionMaxDays: Number(env.SESSION_MAX_DAYS) || 30,
};

export const smtp = {
  host: env.SMTP_HOST || "",
  port: Number(env.SMTP_PORT) || 587,
  secure: flag(env.SMTP_SECURE, Number(env.SMTP_PORT) === 465),
  user: env.SMTP_USER || "",
  pass: env.SMTP_PASS || "",
  from: env.MAIL_FROM || env.SMTP_USER || "RefBoard <no-reply@localhost>",
};
export const mailConfigured = !!smtp.host;

/** 의견 보내기 수신 메일 */
export const FEEDBACK_EMAIL = (env.FEEDBACK_EMAIL || "cokean89@gmail.com").trim();
/** 관리자(피드백 목록을 볼 수 있는 계정) 메일 — 비우면 FEEDBACK_EMAIL */
export const ADMIN_EMAILS = list(env.ADMIN_EMAILS).length ? list(env.ADMIN_EMAILS) : [FEEDBACK_EMAIL.toLowerCase()];

export const oauth = {
  kakao: {
    clientId: env.KAKAO_CLIENT_ID || "",
    clientSecret: env.KAKAO_CLIENT_SECRET || "",
  },
  naver: {
    clientId: env.NAVER_CLIENT_ID || "",
    clientSecret: env.NAVER_CLIENT_SECRET || "",
  },
};

/** 팀별 저장 공간 (올린 이미지 · 링크 사본 합계). TEAM_STORAGE_LIMIT_GB, 기본 5 — 요청마다 읽는다 */
export const teamStorageLimit = () => Math.round((Number(process.env.TEAM_STORAGE_LIMIT_GB) || 5) * 1024 ** 3);
/** 디스크에 저장할 때 늘 비워 둘 공간 (데이터베이스 · 백업용). STORAGE_RESERVE_MB, 기본 300 */
export const storageReserve = () => (Number(process.env.STORAGE_RESERVE_MB) || 300) * 1024 ** 2;
