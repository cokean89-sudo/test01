// 로그인한 사용자만 쓸 수 있는 도구: 링크 스크랩, 이미지 프록시, AI 분석 (사용자별 요청 제한)

import { Router } from "express";
import { z } from "zod";
import { fileIdOf } from "../../shared/files";
import { emptyAxes } from "../../shared/tags";
import { aiStatus, analyzePage, heuristicAnalysis, suggestTags, type AiUsage, type ImageLoader } from "../ai";
import { hasRole, requireUser } from "../context";
import { aiBudget, assertAiAllowed, checkAiBudget, recordAiUsage } from "../limits";
import { fetchImage } from "../net";
import { scrapeUrl } from "../scrape";
import type { Repo, UserRow } from "../repo";
import { enforceLimit } from "../security";
import type { FileStore } from "../storage";

const MIN = 60_000;

export function toolsRouter(repo: Repo, store: FileStore): Router {
  const r = Router();

  /** AI 가 앱에 저장한 이미지를 볼 때: 요청한 사람이 그 팀 멤버인지 확인하고 저장소에서 바로 읽는다 */
  const loaderFor =
    (user: UserRow): ImageLoader =>
    async (url) => {
      const id = fileIdOf(url);
      if (!id) return undefined;
      const f = repo.getFile(id);
      if (!f || !hasRole(repo.getRole(f.team_id, user.id), "viewer")) return null;
      const obj = await store.get(f.key);
      return obj ? { data: obj.data, type: "image/webp" } : null;
    };

  /** 사용량을 어느 팀에 기록할지 — 요청에 온 팀의 멤버일 때만 */
  const teamOf = (user: UserRow, teamId?: string) => (teamId && hasRole(repo.getRole(teamId, user.id), "viewer") ? teamId : null);

  r.get("/status", (req, res) => {
    requireUser(req);
    const status = aiStatus();
    const budget = aiBudget(repo);
    // 이번 달 예산을 다 쓰면 모든 AI 가 쉰다 (화면에는 'AI 쉬는 중')
    res.json(status.ai && budget.paused ? { ...status, ai: false, aiPaused: true, aiReason: budget.reason } : status);
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
    teamId: z.string().max(40).optional(),
  });

  r.post("/ai/analyze", async (req, res) => {
    const user = requireUser(req);
    enforceLimit(`ai:${user.id}`, 60, 60 * MIN, "AI 사용 한도(시간당 60회)를 넘었어요.");
    const { teamId, ...input } = AnalyzeInput.parse(req.body);
    if (aiStatus().ai) {
      // 서비스 예산을 다 썼으면 AI 없이 기본 초안만 (다음 달 1일에 다시 켜짐)
      const budget = checkAiBudget(repo);
      if (budget.paused) {
        res.json({ ...heuristicAnalysis(input), fields: input.fields, notice: budget.reason });
        return;
      }
      assertAiAllowed(repo, user, "write");
    }
    const onUsage = (u: AiUsage) => recordAiUsage(repo, user, teamOf(user, teamId), "write", u.model, u.tokens);
    res.json(await analyzePage(input, { load: loaderFor(user), onUsage }));
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
        teamId: z.string().max(40).optional(),
      })
      .parse(req.body);
    const { teamId, ...input } = body;
    if (aiStatus().ai) {
      const budget = checkAiBudget(repo);
      if (budget.paused) {
        res.json({ axes: emptyAxes(), tags: [], engine: "off", notice: budget.reason });
        return;
      }
      assertAiAllowed(repo, user, "tag");
    }
    const onUsage = (u: AiUsage) => recordAiUsage(repo, user, teamOf(user, teamId), "tag", u.model, u.tokens);
    res.json(await suggestTags(input, { load: loaderFor(user), onUsage }));
  });

  return r;
}
