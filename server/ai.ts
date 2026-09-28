// Claude 로 페이지/케이스 분석 → 타이틀·태그라인·설명·캡션·태그 생성.
// 키가 없거나 호출이 실패하면 규칙 기반(heuristic) 결과로 대체해 앱은 계속 동작한다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AnalyzeRequest, AnalyzeResult, AppStatus, TagSuggestRequest, TagSuggestResult } from "../shared/types";
import { fetchImage } from "./net";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5";
const MAX_IMAGES = 12;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

export function aiStatus(): AppStatus {
  const env = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_PROFILE ||
    process.env.ANTHROPIC_FEDERATION_RULE_ID
  );
  const profileDir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "anthropic");
  const profile = fs.existsSync(profileDir);
  return {
    ai: env || profile,
    model: MODEL,
    aiReason: env || profile ? undefined : "ANTHROPIC_API_KEY 가 설정되지 않아 규칙 기반 제안으로 동작합니다.",
  };
}

// ─── image input ────────────────────────────────────────────

type ImageBlock = Anthropic.Beta.BetaImageBlockParam;

/** 서버에서 직접 받아 base64 로 전달 (핫링크 차단 회피). 실패하면 URL 소스로 넘긴다. */
async function imageBlock(url: string): Promise<ImageBlock | null> {
  try {
    const { data, type } = await fetchImage(url, 4.5 * 1024 * 1024);
    if (IMAGE_TYPES.has(type)) {
      return { type: "image", source: { type: "base64", media_type: type as "image/jpeg", data: data.toString("base64") } };
    }
    return null; // svg/avif 등은 비전 입력 미지원 → 메타데이터만 사용
  } catch {
    return /^https:\/\//.test(url) ? { type: "image", source: { type: "url", url } } : null;
  }
}

// ─── schemas ────────────────────────────────────────────────

const PageAnalysis = z.object({
  title: z.string().describe("페이지 타이틀. 짧고 명확하게 (고유명사/영문 가능, 2~4단어)"),
  subtitle: z.string().describe("타이틀 옆 서브타이틀 한 줄 (리그-팀, 카테고리, 컨셉 요약 등)"),
  highlight: z.string().describe("강조 라인 한 줄 (스폰서/소유/핵심 수치 등 사실 정보). 적을 것이 없으면 빈 문자열"),
  description: z.string().describe("본문 설명 2~4문장. 보고서 문체"),
  sectionLabel: z.string().describe("이미지 그룹 라벨 (예: Reference, Space, Goods, Night View)"),
  captions: z.array(z.string()).describe("입력 이미지 순서대로 각 이미지의 짧은 캡션"),
  tags: z.array(z.string()).describe("이 페이지를 찾을 때 쓸 키워드 태그 3~8개"),
});

const TagSuggestion = z.object({
  title: z.string().describe("이미지를 설명하는 짧은 제목"),
  tags: z.array(z.string()).describe("검색·분류용 키워드 태그 4~8개"),
});

// ─── prompts ────────────────────────────────────────────────

function systemPrompt(language: "ko" | "en"): string {
  const lang =
    language === "ko"
      ? "모든 텍스트는 한국어로 작성하되, 고유명사·브랜드명·장소명은 원어(영문) 표기를 유지한다."
      : "Write every field in English.";
  return [
    "당신은 리테일·브랜드 전략 조직의 리서처로, 보고용 케이스 스터디/레퍼런스 문서의 한 페이지에 들어갈 텍스트를 작성한다.",
    "이미지와 메타데이터(태그, 제목, 메모, 케이스 정보)를 근거로 작성하고, 확인할 수 없는 수치·사실은 지어내지 않는다.",
    "문체: 보고서체. 설명은 '~이다/~한다'로 끝나는 평서문 2~4문장(한국어 기준 250자 내외). 서브타이틀·캡션은 명사형 구절.",
    "캡션은 이미지당 20자 내외로, 무엇을 보여주는지(공간/요소/연출)를 구체적으로 쓴다.",
    "태그는 검색에 쓰일 짧은 키워드(1~3단어)로, 기존 태그와 같은 개념이면 기존 표기를 재사용한다.",
    lang,
  ].join("\n");
}

function pageContext(req: AnalyzeRequest): string {
  const lines: string[] = [];
  lines.push(`페이지 유형: ${req.kind === "case" ? "케이스 스터디 (단일 사례 소개)" : "레퍼런스/아이데이션 (주제별 이미지 모음)"}`);
  if (req.group) lines.push(`그룹/주제: ${req.group}`);
  if (req.keywords?.length) lines.push(`검색 키워드: ${req.keywords.join(", ")}`);
  if (req.caseInfo) lines.push(`케이스 정보: ${JSON.stringify(req.caseInfo)}`);
  if (req.current && Object.values(req.current).some(Boolean)) lines.push(`현재 페이지 텍스트(참고·개선): ${JSON.stringify(req.current)}`);
  if (req.instruction) lines.push(`추가 요청: ${req.instruction}`);
  lines.push(`이미지 수: ${Math.min(req.images.length, MAX_IMAGES)} — captions 배열 길이를 이미지 수와 같게 맞출 것.`);
  return lines.join("\n");
}

// ─── calls ──────────────────────────────────────────────────

async function withImages(images: AnalyzeRequest["images"]): Promise<Anthropic.Beta.BetaContentBlockParam[]> {
  const list = images.slice(0, MAX_IMAGES);
  const blocks = await Promise.all(list.map((img) => imageBlock(img.url)));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  list.forEach((img, i) => {
    const meta = [img.title && `제목: ${img.title}`, img.tags?.length && `태그: ${img.tags.join(", ")}`, img.note && `메모: ${img.note}`]
      .filter(Boolean)
      .join(" / ");
    content.push({ type: "text", text: `이미지 ${i + 1}${meta ? ` — ${meta}` : ""}` });
    const block = blocks[i];
    if (block) content.push(block);
  });
  return content;
}

class RefusalError extends Error {}

async function callStructured<T extends z.ZodType>(
  schema: T,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  effort: "low" | "medium",
): Promise<z.infer<T>> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort, format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new RefusalError(response.stop_details?.explanation ?? "모델이 요청을 거절했습니다.");
  }
  if (!response.parsed_output) throw new Error("AI 응답을 해석하지 못했습니다 (stop_reason: " + response.stop_reason + ")");
  return response.parsed_output as z.infer<T>;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API 키 인증 실패 — ANTHROPIC_API_KEY 를 확인하세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청 한도 초과 — 잠시 후 다시 시도하세요.";
  if (err instanceof Anthropic.BadRequestError) return "요청 오류: " + err.message;
  if (err instanceof Anthropic.APIError) return `API 오류 ${err.status ?? ""}: ${err.message}`;
  if (err instanceof RefusalError) return "AI 가 요청을 처리하지 않았습니다: " + err.message;
  return err instanceof Error ? err.message : String(err);
}

function isMissingCredentials(err: unknown): boolean {
  return (
    err instanceof Anthropic.AuthenticationError ||
    (err instanceof Error && !(err instanceof Anthropic.APIError) && /api[_ ]?key|auth(entication)?|credential/i.test(err.message))
  );
}

export async function analyzePage(req: AnalyzeRequest): Promise<AnalyzeResult> {
  const status = aiStatus();
  if (!status.ai) return { ...heuristicAnalysis(req), notice: status.aiReason };
  try {
    const content = [{ type: "text" as const, text: pageContext(req) }, ...(await withImages(req.images))];
    const out = await callStructured(PageAnalysis, systemPrompt(req.language), content, "medium");
    const captions = req.images.slice(0, MAX_IMAGES).map((_, i) => out.captions[i] ?? "");
    return { ...out, captions, engine: "ai", model: MODEL };
  } catch (err) {
    const fallback = heuristicAnalysis(req);
    if (isMissingCredentials(err)) return { ...fallback, notice: aiStatus().aiReason ?? describeError(err) };
    throw new Error(describeError(err));
  }
}

export async function suggestTags(req: TagSuggestRequest): Promise<TagSuggestResult> {
  const status = aiStatus();
  if (!status.ai) return { tags: heuristicTags(req), title: req.title, engine: "heuristic", notice: status.aiReason };
  try {
    const context = [
      req.title && `현재 제목: ${req.title}`,
      req.note && `메모: ${req.note}`,
      req.existingTags?.length && `현재 태그: ${req.existingTags.join(", ")}`,
      req.vocabulary?.length && `라이브러리에서 쓰는 태그(가능하면 재사용): ${req.vocabulary.slice(0, 80).join(", ")}`,
      "이 레퍼런스 이미지의 제목과 태그를 제안하라.",
    ]
      .filter(Boolean)
      .join("\n");
    const content = [...(await withImages([{ url: req.imageUrl }])), { type: "text" as const, text: context }];
    const out = await callStructured(TagSuggestion, systemPrompt(req.language), content, "low");
    return { tags: out.tags, title: out.title, engine: "ai" };
  } catch (err) {
    if (isMissingCredentials(err)) {
      return { tags: heuristicTags(req), title: req.title, engine: "heuristic", notice: aiStatus().aiReason };
    }
    throw new Error(describeError(err));
  }
}

// ─── heuristic fallback ─────────────────────────────────────

export function heuristicAnalysis(req: AnalyzeRequest): AnalyzeResult {
  const tagFreq = new Map<string, number>();
  for (const img of req.images) for (const t of img.tags ?? []) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const title = req.caseInfo?.name || req.current?.title || req.group || topTags[0] || "Reference";
  const subtitle = req.caseInfo?.subtitle || req.current?.subtitle || topTags.filter((t) => t !== title).slice(0, 3).join(" · ");
  const ko = req.language === "ko";
  const description =
    req.caseInfo?.description ||
    req.current?.description ||
    (ko
      ? `${title} 관련 레퍼런스 ${req.images.length}건을 정리하였다. 주요 키워드는 ${topTags.slice(0, 4).join(", ") || title}이다.`
      : `${req.images.length} references on ${title}. Key themes: ${topTags.slice(0, 4).join(", ") || title}.`);
  return {
    title,
    subtitle,
    highlight: req.caseInfo?.highlight || req.current?.highlight || "",
    description,
    sectionLabel: "Reference",
    captions: req.images.slice(0, MAX_IMAGES).map((img) => img.title ?? ""),
    tags: topTags.slice(0, 8),
    engine: "heuristic",
  };
}

function heuristicTags(req: TagSuggestRequest): string[] {
  const words = `${req.title ?? ""} ${req.note ?? ""}`
    .split(/[\s,./|·\-_()[\]]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 20);
  const vocab = new Set((req.vocabulary ?? []).map((v) => v.toLowerCase()));
  const fromVocab = words.filter((w) => vocab.has(w.toLowerCase()));
  return [...new Set([...(req.existingTags ?? []), ...fromVocab, ...words.slice(0, 4)])].slice(0, 8);
}
