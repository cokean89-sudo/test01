// Claude 로 페이지/케이스 분석 → 타이틀·태그라인·설명·캡션·태그 생성.
// 키가 없거나 호출이 실패하면 규칙 기반(heuristic) 결과로 대체해 앱은 계속 동작한다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { AiPerspective, AiTextField, AiTone, AnalyzeRequest, AnalyzeResult, AppStatus, TagSuggestRequest, TagSuggestResult } from "../shared/types";
import { emptyAxes, flattenAxes, refineAxes, tagKey } from "../shared/tags";
import { fetchImage } from "./net";

/**
 * 작업별 모델 — .env 로 바꿀 수 있다.
 *  · 글쓰기(페이지 분석·타이틀·설명·캡션): CLAUDE_WRITING_MODEL (예전 이름 CLAUDE_MODEL 도 인식)
 *  · 가벼운 작업(태그 제안): CLAUDE_TAG_MODEL
 */
export const MODELS = {
  writing: process.env.CLAUDE_WRITING_MODEL || process.env.CLAUDE_MODEL || "claude-opus-5-5",
  tags: process.env.CLAUDE_TAG_MODEL || "claude-haiku-4-5",
};
/** 예전 코드 호환 — 글쓰기 모델 */
export const MODEL = MODELS.writing;
const MAX_IMAGES = 12;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });

export function aiStatus(): AppStatus {
  // DISABLE_AI=1 이면 키가 있어도 AI 를 끈다 (테스트·비용 통제용)
  if (/^(1|true|yes|on)$/i.test(process.env.DISABLE_AI ?? "")) {
    return { ai: false, model: MODELS.writing, tagModel: MODELS.tags, aiReason: "관리자가 AI 기능을 꺼 두었어요 (DISABLE_AI)." };
  }
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
    model: MODELS.writing,
    tagModel: MODELS.tags,
    aiReason: env || profile ? undefined : "ANTHROPIC_API_KEY 가 설정되지 않아 AI 기능이 꺼져 있어요.",
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
  title: z.string().describe("페이지 타이틀. 2~4단어, 문장부호 없이 (고유명사·영문 가능)"),
  subtitle: z.string().describe("타이틀 옆 서브타이틀 한 줄 명사구 (카테고리·장소·컨셉 요약)"),
  highlight: z.string().describe("강조 라인 한 줄 — 입력에서 확인되는 사실 정보(스폰서·소유·위치 등). 없으면 빈 문자열"),
  description: z.string().describe("본문 설명 2~4문장. 문체 규칙을 따를 것"),
  sectionLabel: z.string().describe("이미지 그룹 라벨 — 영문 1~2단어 (예: Facade, Signage, Night View)"),
  captions: z.array(z.string()).describe("입력 이미지 순서대로 각 이미지의 캡션 (20자 내외 명사구)"),
  tags: z.array(z.string()).describe("이 페이지를 찾을 때 쓸 키워드 태그 3~8개"),
});

const FIELD_LABEL: Record<AiTextField, string> = {
  title: "타이틀",
  subtitle: "서브타이틀",
  highlight: "강조 라인",
  description: "설명",
  sectionLabel: "섹션 라벨",
  captions: "이미지 캡션",
};

/** 항목별 다시 쓰기 — 요청한 항목만 담은 스키마 */
function analysisSchema(fields?: AiTextField[]) {
  if (!fields?.length) return PageAnalysis;
  const mask = Object.fromEntries(fields.map((f) => [f, true])) as Partial<Record<keyof z.infer<typeof PageAnalysis>, true>>;
  return PageAnalysis.pick(mask);
}

const axisList = (what: string) => z.array(z.string()).describe(`${what} — 0~2개, 각 1~3단어`);
const TagSuggestion = z.object({
  title: z.string().describe("이미지를 설명하는 짧은 제목 (명사구)"),
  field: axisList("분야: 업종·영역 (예: 스포츠, 리테일, 전시)"),
  subject: axisList("대상: 무엇·어디 (예: 스타디움, 팝업스토어, 파사드)"),
  element: axisList("요소: 눈에 띄는 구성 요소 (예: 사인물, 조명, 그래픽월)"),
  material: axisList("소재·기법: 재료·가공·표현 기법 (예: ETFE, 네온, 미디어파사드)"),
  color: axisList("컬러: 주조색 (예: 레드, 모노톤)"),
  mood: axisList("무드: 분위기 (예: 야간, 미니멀, 다이내믹)"),
});

function tagSystemPrompt(language: "ko" | "en"): string {
  return [
    "브랜드·공간 레퍼런스 라이브러리의 태그를 제안한다. 태그는 나중에 키워드 검색과 자동 문서 구성에 쓰인다.",
    "",
    "[축] 분야 / 대상 / 요소 / 소재·기법 / 컬러 / 무드 — 축마다 0~2개. 이미지에서 확인되지 않는 축은 비워 둔다.",
    "[재사용] 라이브러리에 이미 있는 태그와 같은 개념이면 반드시 그 표기를 그대로 쓴다 (동의어·띄어쓰기·영문/한글 차이 포함).",
    "[형식] 1~3단어의 짧은 명사. 문장·형용사구·해시(#) 없이.",
    "[금지] pinterest, pin, image, photo, jpg, png, www, com 같은 사이트·파일 흔적, 숫자만 있는 말, 한 글자 말, '레퍼런스'처럼 뭐든 해당되는 말.",
    language === "ko" ? "태그는 한국어로 쓰되, 브랜드명·고유명사·재료명(ETFE 등)은 원어 표기를 쓴다." : "Write tags in English.",
  ].join("\n");
}

// ─── prompts ────────────────────────────────────────────────

/** 관점별 초점과 좋은 예시 — 보고체(report)와 서술체(sentence) 두 벌 */
export const PERSPECTIVE_GUIDE: Record<AiPerspective, { label: string; focus: string; examples: Record<AiTone, string[]> }> = {
  design: {
    label: "디자인 관점",
    focus: "형태·비례, 컬러, 소재·마감, 타이포그래피, 조명·공간 연출과 그 시각적 의도. 이미지에서 보이는 조형 요소를 구체 명사로 짚는다.",
    examples: {
      report: ["외벽 전체를 반투명 ETFE 패널로 감싼 곡면 볼륨 구성.", "팀 컬러 레드 조명으로 야간 파사드를 단일 색면으로 연출."],
      sentence: ["외벽 전체를 반투명 ETFE 패널로 감싼 곡면 볼륨으로 구성했다.", "팀 컬러 레드 조명으로 야간 파사드를 단일 색면으로 연출했다."],
    },
  },
  planning: {
    label: "기획 관점",
    focus: "목적, 타깃, 전략, 경험(동선·체류) 설계, 기대 효과. 무엇을 누구에게 어떻게 전달하려는지 구조로 정리한다.",
    examples: {
      report: ["경기 없는 날에도 방문 동기를 만드는 체류형 공간 구성.", "입장 동선 전체에 팀 컬러를 적용해 홈 팬의 소속감 강조."],
      sentence: ["경기 없는 날에도 방문 동기를 만드는 체류형 공간으로 구성했다.", "입장 동선 전체에 팀 컬러를 적용해 홈 팬의 소속감을 강조했다."],
    },
  },
  fact: {
    label: "팩트 나열",
    focus: "이미지와 메타데이터에서 확인 가능한 정보만 나열. 해석·평가·의도 추정 없이 무엇이 어디에 어떻게 있는지만.",
    examples: {
      report: ["게이트 상단에 'GATE 7' 사인 설치.", "외벽에 마름모 패턴 조명 패널 반복 배치."],
      sentence: ["게이트 상단에 'GATE 7' 사인이 있다.", "외벽에 마름모 패턴 조명 패널이 반복 배치되어 있다."],
    },
  },
};

const TONE_RULES: Record<AiTone, string[]> = {
  report: [
    "문체: 보고체. 모든 문장을 명사형으로 끝낸다 — 예: ~표현. / ~상징. / ~의미. / ~구성. / ~강조. / ~전달. (그 밖에 ~연출. ~배치. ~적용. ~설계. ~제공. 등)",
    "'~이다', '~한다', '~했다', '~합니다', '~해요'로 끝내지 않는다.",
  ],
  sentence: ["문체: 서술체 평서문. 문장을 '~다'로 끝낸다 (예: ~구성했다. ~강조한다.)."],
};

export function systemPrompt(language: "ko" | "en", perspective: AiPerspective = "design", tone: AiTone = "report"): string {
  const guide = PERSPECTIVE_GUIDE[perspective] ?? PERSPECTIVE_GUIDE.design;
  const ko = language === "ko";
  const lines = [
    "당신은 브랜드·리테일 전략 조직의 리서처로, 보고용 케이스 스터디/레퍼런스 문서 한 페이지에 들어갈 텍스트를 쓴다.",
    "",
    "[근거]",
    "- 이미지와 함께 준 메타데이터(제목, 태그, 메모, 케이스 정보)에서 확인되는 내용만 쓴다.",
    "- 확인할 수 없는 수치·연도·고유 사실(개장 연도, 수용 인원, 매출, 수상 이력 등)은 쓰지 않는다. 입력에 있으면 그대로 옮긴다.",
    "- 추측 표현(~로 보인다, ~인 듯, ~일 것, ~로 추정)은 쓰지 않는다. 확실하지 않으면 그 문장을 뺀다.",
    "",
    "[문장]",
    ...(ko ? TONE_RULES[tone] : ["Style: concise report style. Short declarative fragments; no hedging words (seems, likely, perhaps)."]).map((t) => "- " + t),
    "- 한 문장에 정보 하나. 문장은 짧게.",
    "- 수식 형용사(아름다운, 독특한, 인상적인, 세련된, 웅장한 등)는 최소화하고 구체 명사로 쓴다.",
    "",
    `[관점 — ${guide.label}]`,
    "- 초점: " + guide.focus,
    ...(ko ? guide.examples[tone].map((e) => "- 좋은 예: " + e) : []),
    ko ? "- 피할 예: 웅장하고 아름다운 경기장으로 보인다. (수식어·추측) / 2005년 개장해 7만 명을 수용한다. (입력에 없는 수치)" : "",
    "",
    "[항목]",
    "- 타이틀: 2~4단어, 문장부호 없이. 서브타이틀: 한 줄 명사구.",
    "- 강조 라인: 입력에서 확인되는 사실 한 줄. 없으면 빈 문자열.",
    "- 설명: 2~4문장. 캡션: 이미지마다 20자 내외, 그 이미지가 보여주는 것을 구체적으로.",
    "- 태그: 검색용 짧은 키워드(1~3단어). 기존 태그와 같은 개념이면 기존 표기를 쓴다.",
    "",
    ko ? "모든 텍스트는 한국어로 쓰되, 고유명사·브랜드명·장소명은 원어(영문) 표기를 유지한다." : "Write every field in English.",
  ];
  return lines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

function pageContext(req: AnalyzeRequest): string {
  const lines: string[] = [];
  lines.push(`페이지 유형: ${req.kind === "case" ? "케이스 스터디 (단일 사례 소개)" : "레퍼런스/아이데이션 (주제별 이미지 모음)"}`);
  if (req.group) lines.push(`그룹/주제: ${req.group}`);
  if (req.keywords?.length) lines.push(`검색 키워드: ${req.keywords.join(", ")}`);
  if (req.caseInfo) lines.push(`케이스 정보: ${JSON.stringify(req.caseInfo)}`);
  if (req.current && Object.values(req.current).some(Boolean)) lines.push(`현재 페이지 텍스트(참고·개선): ${JSON.stringify(req.current)}`);
  if (req.fields?.length) {
    lines.push(`이번에는 다음 항목만 새로 쓴다: ${req.fields.map((f) => FIELD_LABEL[f]).join(", ")}. 현재 텍스트와 다른 표현으로.`);
  }
  if (req.instruction) lines.push(`추가 요청: ${req.instruction}`);
  if (!req.fields?.length || req.fields.includes("captions")) {
    lines.push(`이미지 수: ${Math.min(req.images.length, MAX_IMAGES)} — captions 배열 길이를 이미지 수와 같게 맞출 것.`);
  }
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

/**
 * 모델마다 받는 파라미터가 다르다.
 *  · Haiku 4.5 등 이전 세대: adaptive thinking·effort 미지원 → 보내지 않는다
 *  · Opus 5.5 / Opus 5 / Fable 5.1 / Sonnet 5.5: 거절 시 서버 측 대체 모델(fallbacks: "default")을 켠다
 */
export function modelOptions(model: string): { adaptive: boolean; fallback: boolean } {
  const m = model.toLowerCase();
  const older = /haiku|claude-3|claude-(opus|sonnet)-4-[015]\b|claude-(opus|sonnet)-4-\d{8}/.test(m);
  return { adaptive: !older, fallback: /^claude-(opus-5|opus-5-5|fable-5-1|sonnet-5-5)$/.test(m) };
}

async function callStructured<T extends z.ZodType>(
  model: string,
  schema: T,
  system: string,
  content: Anthropic.Beta.BetaContentBlockParam[],
  effort: "low" | "medium" | "high",
): Promise<z.infer<T>> {
  const opts = modelOptions(model);
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    ...(opts.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    ...(opts.adaptive ? { thinking: { type: "adaptive" as const } } : {}),
    output_config: { ...(opts.adaptive ? { effort } : {}), format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") {
    throw new RefusalError(response.stop_details?.explanation ?? "모델이 요청을 거절했어요.");
  }
  if (!response.parsed_output) throw new Error("AI 응답을 해석하지 못했어요 (stop_reason: " + response.stop_reason + ")");
  return response.parsed_output as z.infer<T>;
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API 키 인증 실패 — ANTHROPIC_API_KEY 를 확인하세요.";
  if (err instanceof Anthropic.RateLimitError) return "요청 한도 초과 — 잠시 후 다시 시도하세요.";
  if (err instanceof Anthropic.BadRequestError) return "요청 오류: " + err.message;
  if (err instanceof Anthropic.APIError) return `API 오류 ${err.status ?? ""}: ${err.message}`;
  if (err instanceof RefusalError) return "AI 가 요청을 처리하지 않았어요: " + err.message;
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
  if (!status.ai) return { ...heuristicAnalysis(req), fields: req.fields, notice: status.aiReason };
  try {
    const content = [{ type: "text" as const, text: pageContext(req) }, ...(await withImages(req.images))];
    const out = (await callStructured(
      MODELS.writing,
      analysisSchema(req.fields),
      systemPrompt(req.language, req.perspective, req.tone),
      content,
      "medium",
    )) as Partial<z.infer<typeof PageAnalysis>>;
    const captions = req.images.slice(0, MAX_IMAGES).map((_, i) => out.captions?.[i] ?? "");
    return {
      title: out.title ?? "",
      subtitle: out.subtitle ?? "",
      highlight: out.highlight ?? "",
      description: out.description ?? "",
      sectionLabel: out.sectionLabel ?? "",
      captions,
      tags: out.tags ?? [],
      fields: req.fields,
      engine: "ai",
      model: MODELS.writing,
    };
  } catch (err) {
    const fallback = heuristicAnalysis(req);
    if (isMissingCredentials(err)) return { ...fallback, notice: aiStatus().aiReason ?? describeError(err) };
    throw new Error(describeError(err));
  }
}

/** 태그 제안 — 축별 1~2개. AI 가 없으면 제안하지 않는다 (단어 쪼개기 같은 추측 태깅은 하지 않음) */
export async function suggestTags(req: TagSuggestRequest): Promise<TagSuggestResult> {
  const status = aiStatus();
  const off = (notice?: string): TagSuggestResult => ({ axes: emptyAxes(), tags: [], engine: "off", notice: notice ?? "AI 연결 후 사용할 수 있어요." });
  if (!status.ai) return off("AI 연결 후 사용할 수 있어요. (ANTHROPIC_API_KEY 설정 필요)");
  try {
    const vocabulary = (req.vocabulary ?? []).slice(0, 150);
    const context = [
      req.title && `현재 제목: ${req.title}`,
      req.note && `메모: ${req.note}`,
      req.existingTags?.length && `이미 붙은 태그(다시 제안하지 말 것): ${req.existingTags.join(", ")}`,
      vocabulary.length && `라이브러리의 기존 태그(같은 개념이면 이 표기 사용): ${vocabulary.join(", ")}`,
      "이 레퍼런스 이미지의 제목과 축별 태그를 제안하라.",
    ]
      .filter(Boolean)
      .join("\n");
    const content = [...(await withImages([{ url: req.imageUrl }])), { type: "text" as const, text: context }];
    const out = await callStructured(MODELS.tags, TagSuggestion, tagSystemPrompt(req.language), content, "low");
    const axes = refineAxes(out, vocabulary, req.existingTags ?? []);
    return { axes, tags: flattenAxes(axes), title: out.title, engine: "ai", model: MODELS.tags };
  } catch (err) {
    if (isMissingCredentials(err)) return off();
    throw new Error(describeError(err));
  }
}

// ─── heuristic fallback ─────────────────────────────────────

export function heuristicAnalysis(req: AnalyzeRequest): AnalyzeResult {
  // 대소문자·띄어쓰기만 다른 태그("Red"/"red")는 하나로 센다
  const tagFreq = new Map<string, { tag: string; n: number }>();
  for (const img of req.images)
    for (const t of img.tags ?? []) {
      const cur = tagFreq.get(tagKey(t)) ?? { tag: t, n: 0 };
      cur.n++;
      tagFreq.set(tagKey(t), cur);
    }
  const topTags = [...tagFreq.values()].sort((a, b) => b.n - a.n).map((x) => x.tag);
  const title = req.caseInfo?.name || req.current?.title || req.group || topTags[0] || "Reference";
  const subtitle = req.caseInfo?.subtitle || req.current?.subtitle || topTags.filter((t) => t !== title).slice(0, 3).join(" · ");
  const ko = req.language === "ko";
  const description =
    req.caseInfo?.description ||
    req.current?.description ||
    (ko
      ? `${title} 관련 레퍼런스 ${req.images.length}건 정리. 주요 키워드 ${topTags.slice(0, 4).join(", ") || title} 중심 구성.`
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
