import "./env";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { CaseStudy, DocumentData, DocumentSummary, Reference } from "../shared/types";
import { aiStatus, analyzePage, suggestTags } from "./ai";
import { JsonDb, type DbShape } from "./db";
import { FetchError, fetchImage } from "./net";
import { sampleData } from "./sample";
import { scrapeUrl } from "./scrape";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// --prod: 빌드된 dist/ 제공, --open: 시작 후 브라우저 열기 (Windows 에서도 동작하도록 환경변수 대신 인자로)
const isProd = process.env.NODE_ENV === "production" || process.argv.includes("--prod");
const openOnStart = process.argv.includes("--open") || process.env.OPEN_BROWSER === "1";
const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || "127.0.0.1";
const db = new JsonDb(process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, "data"));

const app = express();
app.use(express.json({ limit: "20mb" }));

const newId = (prefix: string) => prefix + crypto.randomUUID().replaceAll("-", "").slice(0, 12);

// ─── validation ─────────────────────────────────────────────

const tagList = z.array(z.string().trim().min(1).max(60)).max(50);

const RefInput = z.object({
  imageUrl: z.string().trim().min(1).max(4000),
  sourceUrl: z.string().max(4000).optional(),
  title: z.string().max(500).optional(),
  note: z.string().max(5000).optional(),
  tags: tagList.default([]),
  caseId: z.string().optional(),
  kind: z.enum(["image", "logo"]).default("image"),
  logoLabel: z.string().max(100).optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  source: z.enum(["pinterest", "web", "image", "manual", "sample"]).default("manual"),
});

const RefPatch = RefInput.partial().extend({ caseId: z.string().nullable().optional() });

const CaseInput = z.object({
  name: z.string().trim().min(1).max(200),
  subtitle: z.string().max(300).optional(),
  highlight: z.string().max(500).optional(),
  description: z.string().max(5000).optional(),
  tags: tagList.default([]),
});

const DocInput = z
  .object({
    id: z.string().optional(),
    title: z.string().max(300),
    query: z.string().max(1000).optional(),
    settings: z.record(z.string(), z.unknown()),
    pages: z.array(z.record(z.string(), z.unknown())),
  })
  .passthrough();

function mergeTags(a: string[], b: string[]): string[] {
  const out = [...a];
  for (const t of b) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

const summary = (d: DocumentData): DocumentSummary => {
  const firstImage = d.pages.flatMap((p) => p.elements).find((e) => e.type === "image");
  return {
    id: d.id,
    title: d.title,
    query: d.query,
    pageCount: d.pages.length,
    updatedAt: d.updatedAt,
    createdAt: d.createdAt,
    cover: firstImage && firstImage.type === "image" ? firstImage.src : undefined,
  };
};

function notFound(res: Response, what: string) {
  res.status(404).json({ error: `${what}을(를) 찾을 수 없습니다` });
}

// ─── status / library ──────────────────────────────────────

app.get("/api/status", (_req, res) => {
  res.json(aiStatus());
});

app.get("/api/library", (_req, res) => {
  res.json({ references: db.data.references, cases: db.data.cases });
});

app.post("/api/references", (req, res) => {
  const list = z.array(RefInput).max(500).parse(Array.isArray(req.body) ? req.body : [req.body]);
  const created: Reference[] = [];
  const merged: Reference[] = [];
  for (const input of list) {
    const existing = db.data.references.find((r) => r.imageUrl === input.imageUrl);
    if (existing) {
      existing.tags = mergeTags(existing.tags, input.tags);
      if (input.caseId && !existing.caseId) existing.caseId = input.caseId;
      merged.push(existing);
      continue;
    }
    const ref: Reference = { ...input, id: newId("r"), createdAt: Date.now() };
    db.data.references.unshift(ref);
    created.push(ref);
  }
  db.save();
  res.json({ created, merged });
});

app.patch("/api/references/:id", (req, res) => {
  const ref = db.data.references.find((r) => r.id === req.params.id);
  if (!ref) return notFound(res, "레퍼런스");
  const patch = RefPatch.parse(req.body);
  Object.assign(ref, patch);
  if (patch.caseId === null) delete ref.caseId;
  db.save();
  res.json(ref);
});

app.post("/api/references/bulk", (req, res) => {
  const body = z
    .object({
      ids: z.array(z.string()).max(2000),
      addTags: tagList.optional(),
      removeTags: tagList.optional(),
      caseId: z.string().nullable().optional(),
      kind: z.enum(["image", "logo"]).optional(),
      delete: z.boolean().optional(),
    })
    .parse(req.body);
  const ids = new Set(body.ids);
  if (body.delete) {
    db.data.references = db.data.references.filter((r) => !ids.has(r.id));
  } else {
    const remove = new Set((body.removeTags ?? []).map((t) => t.toLowerCase()));
    for (const r of db.data.references) {
      if (!ids.has(r.id)) continue;
      if (body.addTags) r.tags = mergeTags(r.tags, body.addTags);
      if (remove.size) r.tags = r.tags.filter((t) => !remove.has(t.toLowerCase()));
      if (body.caseId === null) delete r.caseId;
      else if (body.caseId) r.caseId = body.caseId;
      if (body.kind) r.kind = body.kind;
    }
  }
  db.save();
  res.json({ references: db.data.references });
});

/** 태그 이름 변경/병합 (라이브러리 전체) */
app.post("/api/tags/rename", (req, res) => {
  const { from, to } = z.object({ from: z.string().min(1), to: z.string().trim().max(60) }).parse(req.body);
  const lower = from.toLowerCase();
  for (const list of [db.data.references, db.data.cases]) {
    for (const item of list) {
      if (!item.tags.some((t) => t.toLowerCase() === lower)) continue;
      const rest = item.tags.filter((t) => t.toLowerCase() !== lower);
      item.tags = to ? mergeTags(rest, [to]) : rest;
    }
  }
  db.save();
  res.json({ references: db.data.references, cases: db.data.cases });
});

app.post("/api/cases", (req, res) => {
  const input = CaseInput.parse(req.body);
  const c: CaseStudy = { ...input, id: newId("c"), createdAt: Date.now() };
  db.data.cases.unshift(c);
  db.save();
  res.json(c);
});

app.patch("/api/cases/:id", (req, res) => {
  const c = db.data.cases.find((x) => x.id === req.params.id);
  if (!c) return notFound(res, "케이스");
  Object.assign(c, CaseInput.partial().parse(req.body));
  db.save();
  res.json(c);
});

app.delete("/api/cases/:id", (req, res) => {
  db.data.cases = db.data.cases.filter((c) => c.id !== req.params.id);
  for (const r of db.data.references) if (r.caseId === req.params.id) delete r.caseId;
  db.save();
  res.json({ ok: true });
});

// ─── documents ──────────────────────────────────────────────

app.get("/api/documents", (_req, res) => {
  res.json([...db.data.documents].sort((a, b) => b.updatedAt - a.updatedAt).map(summary));
});

app.get("/api/documents/:id", (req, res) => {
  const doc = db.data.documents.find((d) => d.id === req.params.id);
  if (!doc) return notFound(res, "문서");
  res.json(doc);
});

app.post("/api/documents", (req, res) => {
  const input = DocInput.parse(req.body) as unknown as DocumentData;
  const now = Date.now();
  const doc: DocumentData = { ...input, id: input.id && !db.data.documents.some((d) => d.id === input.id) ? input.id : newId("d"), createdAt: now, updatedAt: now };
  db.data.documents.push(doc);
  db.save();
  res.json(doc);
});

app.put("/api/documents/:id", (req, res) => {
  const idx = db.data.documents.findIndex((d) => d.id === req.params.id);
  if (idx < 0) return notFound(res, "문서");
  const input = DocInput.parse(req.body) as unknown as DocumentData;
  db.data.documents[idx] = { ...input, id: req.params.id, createdAt: db.data.documents[idx].createdAt, updatedAt: Date.now() };
  db.save();
  res.json({ updatedAt: db.data.documents[idx].updatedAt });
});

app.post("/api/documents/:id/duplicate", (req, res) => {
  const src = db.data.documents.find((d) => d.id === req.params.id);
  if (!src) return notFound(res, "문서");
  const now = Date.now();
  const copy: DocumentData = { ...structuredClone(src), id: newId("d"), title: src.title + " (사본)", createdAt: now, updatedAt: now };
  db.data.documents.push(copy);
  db.save();
  res.json(summary(copy));
});

app.delete("/api/documents/:id", (req, res) => {
  db.data.documents = db.data.documents.filter((d) => d.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});

// ─── scrape / proxy / AI ────────────────────────────────────

app.post("/api/scrape", async (req, res) => {
  const { url } = z.object({ url: z.string().min(1).max(4000) }).parse(req.body);
  res.json(await scrapeUrl(url));
});

app.get("/api/proxy", async (req, res) => {
  const url = z.string().min(1).parse(req.query.url);
  const { data, type } = await fetchImage(url);
  res.set({
    "content-type": type,
    "cache-control": "public, max-age=86400",
    "x-content-type-options": "nosniff",
    // SVG 안의 스크립트가 이 도메인에서 실행되지 않도록
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
  });
  res.send(data);
});

const AnalyzeInput = z.object({
  kind: z.enum(["case", "reference", "cover", "section", "blank"]),
  language: z.enum(["ko", "en"]).default("ko"),
  group: z.string().max(300).optional(),
  keywords: z.array(z.string().max(100)).max(30).optional(),
  caseInfo: z.record(z.string(), z.string().max(5000).optional()).optional(),
  current: z.record(z.string(), z.string().max(5000).optional()).optional(),
  images: z
    .array(
      z.object({
        url: z.string().max(4000),
        title: z.string().max(500).optional(),
        note: z.string().max(2000).optional(),
        tags: z.array(z.string().max(60)).max(50).optional(),
      }),
    )
    .max(40),
  instruction: z.string().max(2000).optional(),
});

app.post("/api/ai/analyze", async (req, res) => {
  res.json(await analyzePage(AnalyzeInput.parse(req.body)));
});

app.post("/api/ai/tags", async (req, res) => {
  const body = z
    .object({
      imageUrl: z.string().min(1).max(4000),
      title: z.string().max(500).optional(),
      note: z.string().max(2000).optional(),
      existingTags: z.array(z.string()).max(50).optional(),
      vocabulary: z.array(z.string()).max(300).optional(),
      language: z.enum(["ko", "en"]).default("ko"),
    })
    .parse(req.body);
  res.json(await suggestTags(body));
});

// ─── backup / sample ────────────────────────────────────────

app.get("/api/backup", (_req, res) => {
  db.flush();
  res.set("content-disposition", `attachment; filename="refboard-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(db.data);
});

app.post("/api/backup", (req, res) => {
  const body = z
    .object({
      mode: z.enum(["merge", "replace"]).default("merge"),
      data: z.object({
        references: z.array(z.record(z.string(), z.unknown())).default([]),
        cases: z.array(z.record(z.string(), z.unknown())).default([]),
        documents: z.array(z.record(z.string(), z.unknown())).default([]),
      }),
    })
    .parse(req.body);
  const incoming = body.data as unknown as DbShape;
  if (body.mode === "replace") {
    db.replace({ version: 1, references: incoming.references, cases: incoming.cases, documents: incoming.documents });
  } else {
    const mergeById = <T extends { id: string }>(cur: T[], add: T[]) => {
      const ids = new Set(cur.map((x) => x.id));
      return [...cur, ...add.filter((x) => x.id && !ids.has(x.id))];
    };
    db.data.references = mergeById(db.data.references, incoming.references);
    db.data.cases = mergeById(db.data.cases, incoming.cases);
    db.data.documents = mergeById(db.data.documents, incoming.documents);
    db.save();
  }
  res.json({ references: db.data.references.length, cases: db.data.cases.length, documents: db.data.documents.length });
});

app.post("/api/sample", (_req, res) => {
  const sample = sampleData();
  const existing = new Set(db.data.references.map((r) => r.imageUrl));
  const refs = sample.references.filter((r) => !existing.has(r.imageUrl));
  if (refs.length) {
    const hasCase = db.data.cases.find((c) => c.name === sample.cases[0].name);
    const caseId = hasCase?.id ?? sample.cases[0].id;
    if (!hasCase) db.data.cases.unshift(sample.cases[0]);
    for (const r of refs) if (r.caseId) r.caseId = caseId;
    db.data.references.unshift(...refs);
    db.save();
  }
  res.json({ added: refs.length });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "알 수 없는 API" });
});

// ─── error handler ──────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "입력값 오류: " + err.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(", ") });
    return;
  }
  if (err instanceof FetchError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : "서버 오류" });
});

// ─── client ─────────────────────────────────────────────────

async function start() {
  const server = http.createServer(app);
  if (isProd) {
    const dist = path.join(root, "dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      console.error("dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.");
      process.exit(1);
    }
    app.use(express.static(dist, { index: false }));
    app.use((_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    // HMR 웹소켓을 같은 포트에 붙인다
    const vite = await createServer({ root, server: { middlewareMode: true, hmr: { server } }, appType: "spa" });
    app.use(vite.middlewares);
  }
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  포트 ${PORT} 가 이미 사용 중입니다. RefBoard 가 이미 켜져 있다면 브라우저에서 ${url} 을 여세요.`);
      console.error("  다른 포트로 실행하려면 .env 에 PORT=5179 처럼 지정하세요.\n");
      if (openOnStart) openBrowser(url);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, HOST, () => {
    const status = aiStatus();
    console.log(`\n  RefBoard  →  ${url}`);
    console.log(`  AI: ${status.ai ? `Claude (${status.model})` : "미설정 — " + status.aiReason}`);
    console.log("  종료: 이 창에서 Ctrl+C\n");
    if (openOnStart) openBrowser(url);
  });
  const shutdown = () => {
    db.flush();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => console.log(`  브라우저를 자동으로 열지 못했습니다. 직접 ${url} 을 여세요.`))
    .unref();
}

start();
