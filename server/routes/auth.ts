// 인증: 메일 가입·인증, 로그인/로그아웃, 비밀번호 재설정, 카카오·네이버 로그인

import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AuthProviders } from "../../shared/types";
import { APP_URL, auth, isProd, LOCAL_ONLY, mailConfigured, oauth, ROOT } from "../config";
import { requireUser } from "../context";
import { sendExistingAccountMail, sendResetMail, sendVerifyMail } from "../mail";
import type { Repo, UserRow } from "../repo";
import {
  clearCookie,
  enforceLimit,
  hashPassword,
  HttpError,
  OAUTH_COOKIE,
  parseCookies,
  passwordProblem,
  randomToken,
  safeEqual,
  SESSION_COOKIE,
  setCookie,
  verifyPassword,
} from "../security";

const HOUR = 60 * 60 * 1000;
const email = z.string().trim().toLowerCase().email("올바른 메일 주소가 아니에요.").max(254);
const password = z.string().min(1).max(200);
const name = z.string().trim().min(1, "이름을 입력하세요.").max(40);

/**
 * 로그인 세션 발급. remember(로그인 상태 유지)
 *  · true  — SESSION_MAX_DAYS 동안 남는 쿠키 (서버 세션은 SESSION_DAYS 무활동 시 만료)
 *  · false — 브라우저를 닫으면 사라지는 세션 쿠키 (서버 세션도 12시간 무활동/최대 1일)
 */
export function startSession(repo: Repo, req: Request, res: Response, user: UserRow, remember = false) {
  // 세션 고정 공격 방지: 기존 세션을 버리고 새로 발급
  if (req.sessionToken) repo.deleteSession(req.sessionToken);
  const token = repo.createSession(user.id, req.ip, req.get("user-agent"), remember);
  setCookie(res, SESSION_COOKIE, token, remember ? auth.sessionMaxDays * 24 * 3600 : null);
  repo.recordLoginSuccess(user.id);
  return token;
}

function sessionInfo(repo: Repo, user: UserRow) {
  return { user: repo.userInfo(user), teams: repo.listTeams(user.id) };
}

function domainAllowed(addr: string) {
  if (!auth.signupDomains.length) return true;
  const domain = addr.split("@")[1]?.toLowerCase() ?? "";
  return auth.signupDomains.some((d) => domain === d || domain.endsWith("." + d));
}

/** 메일이 설정되지 않은 개발 환경에서만 인증 링크를 화면에 보여준다 */
// 메일 서버가 없을 때 인증·재설정 링크를 화면에 바로 보여준다.
// 개발 모드이거나, 이 컴퓨터에서만 접속되는 개인 실행일 때만 — 외부 공개 서버에서는 절대 응답에 싣지 않는다.
const devLink = (path: string) => (!mailConfigured && (!isProd || LOCAL_ONLY) ? `${APP_URL}/#/${path}` : undefined);

export function authRouter(repo: Repo): Router {
  const r = Router();

  r.get("/providers", (_req, res) => {
    const out: AuthProviders = {
      brand: brandAssets(),
      email: true,
      signup: auth.allowSignup,
      kakao: !!oauth.kakao.clientId,
      naver: !!(oauth.naver.clientId && oauth.naver.clientSecret),
      mail: mailConfigured,
      signupDomains: auth.signupDomains,
    };
    res.json(out);
  });

  r.get("/me", (req, res) => {
    res.json(sessionInfo(repo, requireUser(req)));
  });

  r.post("/signup", async (req, res) => {
    enforceLimit(`signup:${req.ip}`, 10, HOUR);
    if (!auth.allowSignup) throw new HttpError(403, "메일 가입이 비활성화되어 있어요. 관리자에게 문의하세요.");
    const body = z.object({ email, password, name }).parse(req.body);
    if (!domainAllowed(body.email)) throw new HttpError(403, `가입할 수 있는 메일 도메인: ${auth.signupDomains.join(", ")}`);
    const problem = passwordProblem(body.password, body.email);
    if (problem) throw new HttpError(400, problem, "weak_password");

    const existing = repo.findUserByEmail(body.email);
    let link: string | undefined;
    let delivered = false;
    if (existing) {
      // 가입 여부를 응답으로 드러내지 않는다 — 기존 계정 주인에게 안내 메일만 보낸다
      if (existing.email_verified_at) delivered = (await sendExistingAccountMail(body.email)).delivered;
      else {
        const token = repo.createEmailToken(existing.id, "verify", 24 * HOUR);
        delivered = (await sendVerifyMail(body.email, token)).delivered;
        link = devLink(`verify/${token}`);
      }
      repo.security("signup_existing", existing.id, req.ip);
    } else {
      const user = repo.createUser({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password), verified: false });
      const token = repo.createEmailToken(user.id, "verify", 24 * HOUR);
      delivered = (await sendVerifyMail(body.email, token)).delivered;
      link = devLink(`verify/${token}`);
      repo.security("signup", user.id, req.ip);
    }
    res.json({ ok: true, mailDelivered: delivered, devLink: link });
  });

  r.post("/verify", (req, res) => {
    enforceLimit(`verify:${req.ip}`, 30, HOUR);
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const userId = repo.consumeEmailToken(token, "verify");
    if (!userId) throw new HttpError(400, "인증 링크가 만료되었거나 이미 사용됐어요. 로그인 화면에서 인증 메일을 다시 받으세요.", "invalid_token");
    repo.markVerified(userId);
    const user = repo.getUser(userId)!;
    repo.security("email_verified", userId, req.ip);
    startSession(repo, req, res, user);
    res.json(sessionInfo(repo, user));
  });

  r.post("/resend", async (req, res) => {
    enforceLimit(`resend:${req.ip}`, 5, HOUR);
    const body = z.object({ email }).parse(req.body);
    enforceLimit(`resend:${body.email}`, 3, HOUR);
    const user = repo.findUserByEmail(body.email);
    let link: string | undefined;
    if (user && !user.email_verified_at) {
      const token = repo.createEmailToken(user.id, "verify", 24 * HOUR);
      await sendVerifyMail(body.email, token);
      link = devLink(`verify/${token}`);
    }
    res.json({ ok: true, devLink: link });
  });

  r.post("/login", async (req, res) => {
    const body = z.object({ email, password, remember: z.boolean().optional() }).parse(req.body);
    enforceLimit(`login:${req.ip}`, 30, 15 * 60_000);
    enforceLimit(`login:${body.email}`, 10, 15 * 60_000, "로그인 시도가 너무 많아요. 15분 후 다시 시도하세요.");
    const user = repo.findUserByEmail(body.email);
    if (user?.locked_until && user.locked_until > Date.now()) {
      const min = Math.ceil((user.locked_until - Date.now()) / 60_000);
      throw new HttpError(429, `로그인 실패가 반복되어 잠시 잠겼어요. ${min}분 후 다시 시도하세요.`, "locked");
    }
    const ok = await verifyPassword(body.password, user?.password_hash);
    if (!user || !ok) {
      if (user) repo.recordLoginFailure(user.id);
      repo.security("login_failed", user?.id ?? null, req.ip, body.email);
      throw new HttpError(401, "메일 주소 또는 비밀번호가 올바르지 않아요.", "invalid_credentials");
    }
    if (!user.email_verified_at) throw new HttpError(403, "메일 인증을 완료해야 로그인할 수 있어요.", "unverified");
    startSession(repo, req, res, user, !!body.remember);
    repo.security("login", user.id, req.ip);
    res.json(sessionInfo(repo, user));
  });

  r.post("/logout", (req, res) => {
    if (req.sessionToken) repo.deleteSession(req.sessionToken);
    clearCookie(res, SESSION_COOKIE);
    res.json({ ok: true });
  });

  // 다른 기기(브라우저)의 로그인을 모두 끊는다 — 공용 PC 에서 로그아웃을 잊었을 때
  r.post("/logout-others", (req, res) => {
    const user = requireUser(req);
    const removed = repo.deleteUserSessions(user.id, req.sessionToken);
    repo.security("logout_others", user.id, req.ip);
    res.json({ ok: true, removed });
  });

  r.post("/forgot", async (req, res) => {
    enforceLimit(`forgot:${req.ip}`, 5, HOUR);
    const body = z.object({ email }).parse(req.body);
    enforceLimit(`forgot:${body.email}`, 3, HOUR);
    const user = repo.findUserByEmail(body.email);
    let link: string | undefined;
    if (user) {
      const token = repo.createEmailToken(user.id, "reset", HOUR);
      await sendResetMail(body.email, token);
      link = devLink(`reset/${token}`);
      repo.security("password_reset_requested", user.id, req.ip);
    }
    // 가입 여부와 관계없이 같은 응답
    res.json({ ok: true, devLink: link });
  });

  r.post("/reset", async (req, res) => {
    enforceLimit(`reset:${req.ip}`, 20, HOUR);
    const body = z.object({ token: z.string().min(10).max(200), password }).parse(req.body);
    const userId = repo.consumeEmailToken(body.token, "reset");
    if (!userId) throw new HttpError(400, "재설정 링크가 만료되었거나 이미 사용됐어요. 다시 요청하세요.", "invalid_token");
    const user = repo.getUser(userId)!;
    const problem = passwordProblem(body.password, user.email ?? undefined);
    if (problem) throw new HttpError(400, problem, "weak_password");
    repo.setPassword(userId, await hashPassword(body.password));
    repo.markVerified(userId); // 메일로 받은 링크를 열었으니 메일 소유가 확인됨
    repo.deleteUserSessions(userId); // 다른 기기 로그인 모두 해제
    repo.security("password_reset", userId, req.ip);
    startSession(repo, req, res, repo.getUser(userId)!);
    res.json(sessionInfo(repo, repo.getUser(userId)!));
  });

  r.post("/password", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`pwchange:${user.id}`, 10, HOUR);
    const body = z.object({ current: z.string().max(200).optional(), next: password }).parse(req.body);
    if (user.password_hash && !(await verifyPassword(body.current ?? "", user.password_hash))) {
      throw new HttpError(400, "현재 비밀번호가 올바르지 않아요.", "invalid_credentials");
    }
    const problem = passwordProblem(body.next, user.email ?? undefined);
    if (problem) throw new HttpError(400, problem, "weak_password");
    repo.setPassword(user.id, await hashPassword(body.next));
    repo.deleteUserSessions(user.id, req.sessionToken);
    repo.security("password_changed", user.id, req.ip);
    res.json({ ok: true });
  });

  r.patch("/profile", (req, res) => {
    const user = requireUser(req);
    const body = z.object({ name }).parse(req.body);
    repo.setName(user.id, body.name);
    res.json(sessionInfo(repo, repo.getUser(user.id)!));
  });

  // ─── 소셜 로그인 (OAuth 2.0 authorization code) ───────────────

  r.get("/oauth/:provider/start", (req, res) => {
    const provider = parseProvider(String(req.params.provider));
    enforceLimit(`oauth:${req.ip}`, 30, 10 * 60_000);
    const mode = req.query.mode === "link" && req.user ? "link" : "login";
    const remember = req.query.remember === "1" ? "1" : "0";
    const state = randomToken(24);
    // 로그인 상태 유지 선택을 콜백까지 가져간다
    setCookie(res, OAUTH_COOKIE, `${state}.${mode}.${remember}`, 600);
    res.redirect(302, authorizeUrl(provider, state));
  });

  r.get("/oauth/:provider/callback", async (req, res) => {
    const fail = (msg: string) => res.redirect(302, `${APP_URL}/#/login?error=${encodeURIComponent(msg)}`);
    let provider: Provider;
    try {
      provider = parseProvider(String(req.params.provider));
    } catch {
      return fail("지원하지 않는 로그인 방식이에요.");
    }
    const [savedState, mode, remember] = (parseCookies(req.headers.cookie)[OAUTH_COOKIE] ?? "").split(".");
    clearCookie(res, OAUTH_COOKIE);
    const state = String(req.query.state ?? "");
    if (!savedState || !state || !safeEqual(savedState, state)) return fail("로그인 요청이 만료됐어요. 다시 시도하세요.");
    if (req.query.error) return fail("로그인이 취소됐어요.");
    const code = String(req.query.code ?? "");
    if (!code || code.length > 2000) return fail("잘못된 로그인 응답이에요.");

    let profile: OAuthProfile;
    try {
      profile = await fetchProfile(provider, code, state);
    } catch (err) {
      console.error(`[oauth:${provider}]`, (err as Error).message);
      return fail(`${PROVIDER_LABEL[provider]} 로그인에 실패했어요.`);
    }

    let user: UserRow | undefined;
    const linked = repo.findIdentity(provider, profile.id);
    if (mode === "link" && req.user) {
      if (linked && linked.user_id !== req.user.id) return fail(`이 ${PROVIDER_LABEL[provider]} 계정은 이미 다른 사용자와 연결되어 있어요.`);
      repo.linkIdentity(provider, profile.id, req.user.id, profile.email);
      repo.security("oauth_linked", req.user.id, req.ip, provider);
      return res.redirect(302, `${APP_URL}/#/account?linked=${provider}`);
    }
    if (linked) user = repo.getUser(linked.user_id);
    if (!user && profile.email && profile.emailVerified) {
      // 제공자가 인증한 메일과 같은 계정이 있으면 연결
      const existing = repo.findUserByEmail(profile.email);
      if (existing) {
        user = existing;
        repo.markVerified(existing.id);
      }
    }
    if (!user) {
      const emailFree = profile.email && profile.emailVerified && !repo.findUserByEmail(profile.email);
      user = repo.createUser({ email: emailFree ? profile.email : null, name: profile.name || `${PROVIDER_LABEL[provider]} 사용자`, verified: !!emailFree });
    }
    repo.linkIdentity(provider, profile.id, user.id, profile.email);
    startSession(repo, req, res, user, remember === "1");
    repo.security("login", user.id, req.ip, provider);
    res.redirect(302, `${APP_URL}/#/`);
  });

  return r;
}

// ─── 공식 로그인 버튼 리소스 ────────────────────────────────────

/**
 * 카카오·네이버 개발자 센터에서 받은 공식 심볼 파일을 public/brand/ 에 넣으면 그 파일을 쓴다.
 *  · public/brand/kakao-symbol.svg (또는 .png) — 카카오 말풍선 심볼
 *  · public/brand/naver-symbol.svg (또는 .png) — 네이버 N 로고
 * 없으면 화면이 가이드 색·형태대로 그린 기본 심볼을 쓴다.
 */
function brandAssets(): { kakao?: string; naver?: string } {
  const out: { kakao?: string; naver?: string } = {};
  const dirs = [path.join(ROOT, isProd ? "dist" : "public", "brand")];
  for (const p of ["kakao", "naver"] as const) {
    for (const ext of ["svg", "png"]) {
      if (dirs.some((d) => fs.existsSync(path.join(d, `${p}-symbol.${ext}`)))) {
        out[p] = `/brand/${p}-symbol.${ext}`;
        break;
      }
    }
  }
  return out;
}

// ─── providers ──────────────────────────────────────────────

export type Provider = "kakao" | "naver";
const PROVIDER_LABEL: Record<Provider, string> = { kakao: "카카오", naver: "네이버" };

export interface OAuthProfile {
  id: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

function parseProvider(p: string): Provider {
  if (p === "kakao" && oauth.kakao.clientId) return "kakao";
  if (p === "naver" && oauth.naver.clientId && oauth.naver.clientSecret) return "naver";
  throw new HttpError(404, "지원하지 않는 로그인 방식이에요.");
}

export const redirectUri = (p: Provider) => `${APP_URL}/api/auth/oauth/${p}/callback`;

function authorizeUrl(p: Provider, state: string): string {
  const q = new URLSearchParams({ response_type: "code", client_id: oauth[p].clientId, redirect_uri: redirectUri(p), state });
  return p === "kakao" ? `https://kauth.kakao.com/oauth/authorize?${q}` : `https://nid.naver.com/oauth2.0/authorize?${q}`;
}

async function getJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export async function fetchProfile(p: Provider, code: string, state: string): Promise<OAuthProfile> {
  if (p === "kakao") {
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: oauth.kakao.clientId, redirect_uri: redirectUri("kakao"), code });
    if (oauth.kakao.clientSecret) body.set("client_secret", oauth.kakao.clientSecret);
    const token = await getJson("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body,
    });
    const me = (await getJson("https://kapi.kakao.com/v2/user/me", { headers: { authorization: `Bearer ${token.access_token}` } })) as {
      id?: number | string;
      kakao_account?: { email?: string; is_email_valid?: boolean; is_email_verified?: boolean; profile?: { nickname?: string } };
      properties?: { nickname?: string };
    };
    if (!me.id) throw new Error("카카오 사용자 정보 없음");
    const acc = me.kakao_account ?? {};
    return {
      id: String(me.id),
      email: acc.email?.toLowerCase() ?? null,
      emailVerified: !!(acc.email && acc.is_email_valid !== false && acc.is_email_verified),
      name: acc.profile?.nickname ?? me.properties?.nickname ?? "",
    };
  }
  const q = new URLSearchParams({ grant_type: "authorization_code", client_id: oauth.naver.clientId, client_secret: oauth.naver.clientSecret, code, state });
  const token = await getJson(`https://nid.naver.com/oauth2.0/token?${q}`, { method: "POST" });
  if (!token.access_token) throw new Error(`네이버 토큰 발급 실패: ${String(token.error_description ?? token.error ?? "")}`);
  const me = (await getJson("https://openapi.naver.com/v1/nid/me", { headers: { authorization: `Bearer ${token.access_token}` } })) as {
    resultcode?: string;
    response?: { id?: string; email?: string; name?: string; nickname?: string };
  };
  if (me.resultcode !== "00" || !me.response?.id) throw new Error("네이버 사용자 정보 없음");
  return {
    id: me.response.id,
    email: me.response.email?.toLowerCase() ?? null,
    // 네이버 연락처 메일은 소유 확인이 보장되지 않으므로 @naver.com 주소만 인증된 것으로 본다 (계정 탈취 방지)
    emailVerified: !!me.response.email && me.response.email.toLowerCase().endsWith("@naver.com"),
    name: me.response.name ?? me.response.nickname ?? "",
  };
}
