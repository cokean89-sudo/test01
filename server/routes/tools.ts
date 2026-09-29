// 로그인한 사용자만 쓸 수 있는 도구: 링크 스크랩, 이미지 프록시, AI 분석 (사용자별 요청 제한)

import { Router } from "express";
import { z } from "zod";
import { aiStatus, analyzePage, suggestTags } from "../ai";
import { requireUser } from "../context";
import { fetchImage } from "../net";
import { scrapeUrl } from "../scrape";
import { enforceLimit } from "../security";

const MIN = 60_000;

export function toolsRouter(): Router {
  const r = Router();

  r.get("/status", (req, res) => {
    requireUser(req);
    res.json(aiStatus());
  });

  r.post("/scrape", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`scrape:${user.id}`, 120, 10 * MIN);
    const { url } = z.object({ url: z.string().min(1).max(4000) }).parse(req.body);
    res.json(await scrapeUrl(url));
  });

  r.get("/proxy", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`proxy:${user.id}`, 1500, 10 * MIN);
    const url = z.string().min(1).max(4000).parse(req.query.url);
    const { data, type } = await fetchImage(url);
    res.set({
      "content-type": type,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      // SVG 안의 스크립트가 이 도메인에서 실행되지 않도록
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      "cross-origin-resource-policy": "same-origin",
    });
    res.send(data);
  });

  const AnalyzeInput = z.object({
    kind: z.enum(["case", "reference", "cover", "section", "blank"]),
    language: z.enum(["ko", "en"]).default("ko"),
    perspective: z.enum(["design", "planning", "fact"]).default("design"),
    tone: z.enum(["report", "sentence"]).default("report"),
    fields: z.array(z.enum(["title", "subtitle", "highlight", "description", "sectionLabel", "captions"])).max(6).optional(),
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

  r.post("/ai/analyze", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`ai:${user.id}`, 60, 60 * MIN, "AI 사용 한도(시간당 60회)를 넘었어요.");
    res.json(await analyzePage(AnalyzeInput.parse(req.body)));
  });

  r.post("/ai/tags", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`ai:${user.id}`, 60, 60 * MIN, "AI 사용 한도(시간당 60회)를 넘었어요.");
    const body = z
      .object({
        imageUrl: z.string().min(1).max(4000),
        title: z.string().max(500).optional(),
        note: z.string().max(2000).optional(),
        existingTags: z.array(z.string().max(60)).max(50).optional(),
        vocabulary: z.array(z.string().max(60)).max(300).optional(),
        language: z.enum(["ko", "en"]).default("ko"),
      })
      .parse(req.body);
    res.json(await suggestTags(body));
  });

  return r;
}
