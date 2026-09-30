// AI 예상 비용 — 모델별 단가(ai-prices.json) × 토큰 수. 실제 청구서가 아니라 예산 관리용 추정치다.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config";

export interface ModelPrice {
  /** USD / 100만 토큰 */
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

export interface TokenUsage {
  /** 캐시되지 않은 입력 */
  input: number;
  output: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  cacheRead?: number;
}

interface PriceTable {
  models: Record<string, ModelPrice>;
  default: ModelPrice;
}

let cached: { key: string; table: PriceTable } | null = null;

/** 단가표 — 파일(기본 ai-prices.json, AI_PRICES_FILE) 위에 AI_PRICES(JSON)를 덮어쓴다. 환경변수가 바뀌면 다시 읽는다 */
export function priceTable(): PriceTable {
  const file = process.env.AI_PRICES_FILE ? path.resolve(process.env.AI_PRICES_FILE) : path.join(ROOT, "ai-prices.json");
  const key = `${file}|${process.env.AI_PRICES ?? ""}`;
  if (cached?.key === key) return cached.table;
  const base = JSON.parse(fs.readFileSync(file, "utf8")) as PriceTable;
  const extra = process.env.AI_PRICES ? (JSON.parse(process.env.AI_PRICES) as Partial<PriceTable> & Record<string, ModelPrice>) : {};
  // AI_PRICES 는 { "모델": {…} } 또는 { models: {…}, default: {…} } 둘 다 받는다
  const extraModels = extra.models ?? Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "default" && k !== "models"));
  const table = { models: { ...base.models, ...(extraModels as Record<string, ModelPrice>) }, default: extra.default ?? base.default };
  cached = { key, table };
  return table;
}

/** 날짜가 붙은 모델 이름(claude-haiku-4-5-20251001)도 기본 이름 단가로 */
export function priceOf(model: string): ModelPrice {
  const t = priceTable();
  if (t.models[model]) return t.models[model];
  const base = Object.keys(t.models)
    .filter((m) => model.startsWith(m + "-"))
    .sort((a, b) => b.length - a.length)[0];
  return base ? t.models[base] : t.default;
}

export function costUsd(model: string, u: TokenUsage): number {
  const p = priceOf(model);
  const usd =
    (u.input * p.input + u.output * p.output + (u.cacheWrite5m ?? 0) * p.cacheWrite5m + (u.cacheWrite1h ?? 0) * p.cacheWrite1h + (u.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
