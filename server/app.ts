// Express 앱 구성 — 테스트에서도 같은 앱을 메모리 DB 로 띄울 수 있게 분리했다.

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { TRUST_PROXY } from "./config";
import { authRequired, sessionMiddleware } from "./context";
import type { Database } from "./db";
import { FetchError } from "./net";
import { Repo } from "./repo";
import { authRouter } from "./routes/auth";
import { documentLookupRouter, documentsRouter } from "./routes/documents";
import { libraryRouter } from "./routes/library";
import { invitesRouter, teamsRouter } from "./routes/teams";
import { toolsRouter } from "./routes/tools";
import { csrfGuard, HttpError, noStore, permissionsPolicy, rateLimit, securityHeaders } from "./security";

export function createApp(db: Database) {
  const repo = new Repo(db);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", TRUST_PROXY);
  app.use(securityHeaders());
  app.use(permissionsPolicy);

  const api = express.Router();
  api.use(noStore);
  // 헬스 체크 (Docker·로드밸런서용) — 인증·요청 제한 없이 응답
  api.get("/health", (_req, res) => {
    db.get("SELECT 1");
    res.json({ ok: true });
  });
  api.use(rateLimit("api", 3000, 5 * 60_000)); // IP 당 전체 API 상한 (과도한 자동화 차단)
  api.use(express.json({ limit: "10mb" }));
  api.use(csrfGuard);
  api.use(sessionMiddleware(repo));

  api.use("/auth", authRouter(repo));
  api.use("/invites", authRequired, invitesRouter(repo));
  api.use("/teams", authRequired, teamsRouter(repo));
  api.use("/teams/:teamId", authRequired, libraryRouter(repo));
  api.use("/teams/:teamId", authRequired, documentsRouter(repo));
  api.use("/documents", authRequired, documentLookupRouter(repo));
  api.use("/", toolsRouter());
  api.use((_req, _res, next) => next(new HttpError(404, "알 수 없는 API")));
  api.use(errorHandler);

  app.use("/api", api);
  // 오래된 세션 정리
  setInterval(() => repo.purgeExpired(), 60 * 60_000).unref();
  return { app, repo };
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof z.ZodError) {
    const first = err.issues[0];
    res.status(400).json({ error: first?.message && !/^(Invalid|Expected|Required)/.test(first.message) ? first.message : "입력값이 올바르지 않아요.", code: "invalid_input" });
    return;
  }
  if (err instanceof HttpError) {
    if (err.headers) res.set(err.headers);
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof FetchError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  const e = err as { type?: string; status?: number };
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: "요청이 너무 커요." });
    return;
  }
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: "잘못된 JSON 이에요." });
    return;
  }
  console.error(err);
  // 내부 오류 내용은 노출하지 않는다
  res.status(500).json({ error: "서버 오류가 발생했어요." });
}
