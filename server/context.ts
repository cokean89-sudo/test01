// 요청 컨텍스트 — 세션 인증, 팀 권한 검사

import type { NextFunction, Request, Response } from "express";
import { ROLE_RANK, type Role } from "../shared/types";
import type { Repo, UserRow } from "./repo";
import { HttpError, parseCookies, SESSION_COOKIE } from "./security";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRow;
    sessionToken?: string;
    teamId?: string;
    role?: Role;
  }
}

/** 세션 쿠키가 있으면 사용자를 붙인다 (없어도 통과) */
export function sessionMiddleware(repo: Repo) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token && token.length <= 100) {
      const user = repo.resolveSession(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireUser(req: Request): UserRow {
  if (!req.user) throw new HttpError(401, "로그인이 필요해요.", "unauthenticated");
  return req.user;
}

export function authRequired(req: Request, _res: Response, next: NextFunction) {
  requireUser(req);
  next();
}

/** :teamId 경로 파라미터의 팀 멤버인지, 최소 역할을 가졌는지 확인 */
export function teamRole(repo: Repo, min: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = requireUser(req);
    const teamId = String(req.params.teamId ?? "");
    const role = repo.getRole(teamId, user.id);
    // 팀이 없는 것과 권한이 없는 것을 구분하지 않는다 (팀 id 추측 방지)
    if (!role) throw new HttpError(404, "팀을 찾을 수 없어요.", "not_found");
    if (ROLE_RANK[role] < ROLE_RANK[min]) throw new HttpError(403, "이 작업을 할 권한이 없어요.", "forbidden");
    req.teamId = teamId;
    req.role = role;
    next();
  };
}

export function hasRole(role: Role | undefined, min: Role) {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}
