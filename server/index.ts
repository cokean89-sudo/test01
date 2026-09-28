import "./env";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import { aiStatus } from "./ai";
import { createApp } from "./app";
import { APP_URL, HOST, isProd, mailConfigured, oauth, openOnStart, PORT, ROOT, SECURE_COOKIES } from "./config";
import { openDatabase } from "./db";

async function start() {
  const db = openDatabase();
  const { app } = createApp(db);
  const server = http.createServer(app);

  if (isProd) {
    const dist = path.join(ROOT, "dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      console.error("dist/ 가 없어요. 먼저 `npm run build` 를 실행하세요.");
      process.exit(1);
    }
    app.use(express.static(dist, { index: false, maxAge: "7d", setHeaders: (res, file) => file.endsWith(".html") && res.setHeader("Cache-Control", "no-store") }));
    app.use((_req, res) => res.setHeader("Cache-Control", "no-store").sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    // HMR 웹소켓을 같은 포트에 붙인다
    const vite = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
    app.use(vite.middlewares);
  }

  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  포트 ${PORT} 가 이미 사용 중이에요. RefBoard 가 이미 켜져 있다면 브라우저에서 ${url} 을 여세요.`);
      console.error("  다른 포트로 실행하려면 .env 에 PORT=5179 처럼 지정하세요.\n");
      if (openOnStart) openBrowser(url);
      process.exit(1);
    }
    throw err;
  });
  // 느린 요청으로 연결을 붙잡아 두는 공격 완화
  server.headersTimeout = 20_000;
  server.requestTimeout = 120_000;

  server.listen(PORT, HOST, () => {
    const status = aiStatus();
    console.log(`\n  RefBoard  →  ${url}${APP_URL !== url ? `   (공개 주소: ${APP_URL})` : ""}`);
    console.log(`  AI: ${status.ai ? `Claude (${status.model})` : "미설정 — " + status.aiReason}`);
    console.log(`  메일: ${mailConfigured ? "SMTP 발송" : "미설정 — 인증·초대 링크를 이 창에 출력해요"}`);
    const social = [oauth.kakao.clientId && "카카오", oauth.naver.clientId && "네이버"].filter(Boolean).join(", ");
    console.log(`  소셜 로그인: ${social || "미설정"}`);
    if (isProd && !SECURE_COOKIES && HOST !== "127.0.0.1" && HOST !== "localhost") {
      console.warn("  ⚠ 외부에 공개하는 서버는 HTTPS 주소를 APP_URL 로 지정하세요 (쿠키 보안).");
    }
    console.log("  종료: 이 창에서 Ctrl+C\n");
    if (openOnStart) openBrowser(url);
  });

  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    // 실시간 연결(SSE)은 스스로 끊기지 않으므로 닫아 준다
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => console.log(`  브라우저를 자동으로 열지 못했어요. 직접 ${url} 을 여세요.`))
    .unref();
}

start();
