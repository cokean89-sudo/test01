// Express 앱 구성 — 테스트에서도 같은 앱을 메모리 DB 로 띄울 수 있게 분리했다.

import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { DATA_DIR, TRUST_PROXY } from "./config";
import { authRequired, sessionMiddleware } from "./context";
import type { Database } from "./db";
import { FetchError } from "./net";
import { CollabHub } from "./collab/hub";
import { Repo } from "./repo";
import { authRouter } from "./routes/auth";
import { avatarsRouter, profileRouter } from "./routes/avatars";
import { collabRouter } from "./routes/collab";
import { documentLookupRouter, documentsRouter } from "./routes/documents";
import { adminRouter, feedbackRouter } from "./routes/feedback";
import { libraryRouter } from "./routes/library";
import { invitesRouter, teamsRouter } from "./routes/teams";
import { toolsRouter } from "./routes/tools";
import { cleanupStaleUploads, filesRouter, uploadsRouter } from "./routes/uploads";
import { usageAdminRouter, usageRouter } from "./routes/usage";
import { csrfGuard, HttpError, noStore, permissionsPolicy, rateLimit, securityHeaders } from "./security";
import { createStore, type FileStore } from "./storage";

export function createApp(db: Database, opts: { store?: FileStore; collab?: ConstructorParameters<typeof CollabHub>[1] } = {}) {
  const repo = new Repo(db);
  // 실시간 공동 편집 — 문서별 방 (WebSocket 은 index.ts 에서 attachCollab 으로 붙인다)
  const collab = new CollabHub(repo, opts.collab);
  // 올린 이미지 저장소 — 환경변수(STORAGE_DRIVER 등)로 디스크 · R2 · S3 중에서 고른다
  const store = opts.store ?? createStore(process.env, DATA_DIR);
  // 프로필 기능 전에 만든 계정 · 팀에 기본 이모지 · 색을 채운다 (이미 있으면 그대로)
  repo.fillProfiles();
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
  // 의견 보내기(스크린샷 첨부)는 로그인·횟수 확인 뒤 자체 한도로 읽는다
  const json = express.json({ limit: "10mb" });
  api.use((req, res, next) => (/^\/feedback\/?$/.test(req.path) ? next() : json(req, res, next)));
  api.use(csrfGuard);
  api.use(sessionMiddleware(repo));

  api.use("/auth", authRouter(repo));
  api.use("/invites", authRequired, invitesRouter(repo));
  api.use("/teams", authRequired, teamsRouter(repo, store, collab));
  api.use("/teams/:teamId", authRequired, uploadsRouter(repo, store));
  api.use("/teams/:teamId", authRequired, libraryRouter(repo, store));
  api.use("/teams/:teamId", authRequired, documentsRouter(repo, collab));
  api.use("/documents", authRequired, documentLookupRouter(repo, collab));
  api.use("/collab", authRequired, collabRouter(repo, collab));
  api.use("/feedback", authRequired, feedbackRouter(repo));
  api.use("/admin", authRequired, adminRouter(repo));
  api.use("/admin", authRequired, usageAdminRouter(repo));
  api.use("/usage", authRequired, usageRouter(repo));
  api.use("/files", authRequired, filesRouter(repo, store));
  api.use("/profile", authRequired, profileRouter(repo, store));
  api.use("/avatars", authRequired, avatarsRouter(repo, store));
  api.use("/", toolsRouter(repo, store));
  api.use((_req, _res, next) => next(new HttpError(404, "알 수 없는 API")));
  api.use(errorHandler);

  app.use("/api", api);
  // 휴대폰 공유 메뉴(Web Share Target)는 서비스 워커가 받는다. 서비스 워커가 아직 없을 때만 여기로 온다 → 안내 화면으로
  app.post("/share-target", (_req, res) => {
    res.setHeader("Cache-Control", "no-store").redirect(303, "/#/share/nosw");
  });
  // 오래된 세션 · 올려 두고 저장하지 않은 이미지 정리
  setInterval(() => {
    repo.purgeExpired();
    cleanupStaleUploads(repo, store);
    repo.pruneDocActivity();
  }, 60 * 60_000).unref();
  return { app, repo, store, collab };
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
