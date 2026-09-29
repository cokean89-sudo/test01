// tokens.json(원본) → src/tokens.css 의 생성 구간
//   npm run tokens          다시 만들기
//   npm run tokens -- --check   최신인지만 확인 (다르면 실패)
//
// 이름 규칙: 경로를 - 로 잇는다. color.grey.100 → --color-grey-100
//   · 맨 앞 그룹: typography 는 빼고(--font-size-14), spacing 은 space 로(--space-8)
//   · default 는 생략: color.text.default → --color-text
//   · 별칭 {color.grey.100} → var(--color-grey-100)
// 단위: spacing · radius · size · font-size = px, line-height = %→배수, letter-spacing = %→em, 색 8자리 hex → rgba()

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Json = Record<string, unknown>;
export interface FlatToken {
  path: string[];
  type: string;
  value: unknown;
  description?: string;
}

export const START = "/* ─── tokens.json 에서 생성 — 직접 고치지 말고 tokens.json 을 고친 뒤 `npm run tokens` ─── */";
export const END = "/* ─── 생성 끝 ─── */";

const GROUP_PREFIX: Record<string, string | null> = { color: "color", typography: null, spacing: "space", radius: "radius", size: "size" };

/** 숫자 이름(9, 10-5, 06)은 값 순서로 먼저, 나머지는 적힌 순서대로 — JSON 은 정수 키를 앞으로 옮겨 버리므로 */
function ordered(node: Json): [string, unknown][] {
  const num = (k: string) => (/^\d+(-\d+)?$/.test(k) ? Number(k.replace("-", ".")) : NaN);
  const entries = Object.entries(node).filter(([k]) => !k.startsWith("$"));
  const numeric = entries.filter(([k]) => !Number.isNaN(num(k))).sort((a, b) => num(a[0]) - num(b[0]));
  return [...numeric, ...entries.filter(([k]) => Number.isNaN(num(k)))];
}

export function flatten(node: Json, path: string[] = [], inherited?: string): FlatToken[] {
  const type = (node.$type as string | undefined) ?? inherited;
  if ("$value" in node) {
    if (!type) throw new Error(`$type 이 없는 토큰: ${path.join(".")}`);
    return [{ path, type, value: node.$value, description: node.$description as string | undefined }];
  }
  const out: FlatToken[] = [];
  for (const [k, v] of ordered(node)) {
    if (!v || typeof v !== "object") throw new Error(`잘못된 토큰: ${[...path, k].join(".")}`);
    out.push(...flatten(v as Json, [...path, k], type));
  }
  return out;
}

export function cssName(path: string[]): string {
  const [group, ...rest] = path;
  if (!(group in GROUP_PREFIX)) throw new Error(`모르는 그룹: ${group}`);
  const prefix = GROUP_PREFIX[group];
  const parts = [...(prefix ? [prefix] : []), ...rest].filter((p) => p !== "default");
  return "--" + parts.join("-");
}

function hexToCss(hex: string): string {
  const h = hex.toLowerCase();
  if (!/^#([0-9a-f]{6}|[0-9a-f]{8})$/.test(h)) throw new Error(`색은 #rrggbb 또는 #rrggbbaa: ${hex}`);
  if (h.length === 7) return h;
  const [r, g, b, a] = [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(2))})`;
}

const trim = (n: number) => String(Number(n.toFixed(4)));

export function cssValue(t: FlatToken): string {
  const v = t.value;
  if (typeof v === "string" && /^\{[^}]+\}$/.test(v)) return `var(${cssName(v.slice(1, -1).split("."))})`;
  const [group, sub] = t.path;
  if (t.type === "color") return hexToCss(String(v));
  if (t.type === "fontFamily") return (Array.isArray(v) ? v : [v]).map((f) => (/\s/.test(String(f)) ? `"${f}"` : String(f))).join(", ");
  if (typeof v !== "number") throw new Error(`숫자가 아님: ${t.path.join(".")}`);
  if (group === "typography" && sub === "line-height") return trim(v / 100);
  if (group === "typography" && sub === "letter-spacing") return `${trim(v / 100)}em`;
  if (group === "typography" && sub === "font-weight") return String(v);
  return `${trim(v)}px`;
}

const GROUP_TITLE: Record<string, string> = {
  color: "컬러",
  "typography.font-family": "타이포 — 글꼴",
  "typography.font-size": "타이포 — 글자 크기",
  "typography.font-weight": "타이포 — 굵기",
  "typography.line-height": "타이포 — 행간",
  "typography.letter-spacing": "타이포 — 자간",
  spacing: "간격",
  radius: "모서리",
  size: "크기",
};

export function generateCss(tokens: Json): string {
  const flat = flatten(tokens);
  const names = new Set<string>();
  const lines: string[] = [START, ":root {"];
  let section = "";
  for (const t of flat) {
    const key = t.path[0] === "typography" ? t.path.slice(0, 2).join(".") : t.path[0];
    if (key !== section) {
      if (section) lines.push("");
      lines.push(`  /* ${GROUP_TITLE[key] ?? key} */`);
      section = key;
    }
    const name = cssName(t.path);
    if (names.has(name)) throw new Error(`CSS 이름이 겹침: ${name}`);
    names.add(name);
    lines.push(`  ${name}: ${cssValue(t)};`);
  }
  lines.push("}", END);
  return lines.join("\n");
}

/** 별칭이 모두 실제 토큰을 가리키는지 */
export function checkAliases(tokens: Json): string[] {
  const flat = flatten(tokens);
  const paths = new Set(flat.map((t) => t.path.join(".")));
  return flat.filter((t) => typeof t.value === "string" && /^\{.+\}$/.test(t.value) && !paths.has(String(t.value).slice(1, -1))).map((t) => `${t.path.join(".")} → ${t.value}`);
}

export function replaceGenerated(css: string, generated: string): string {
  const a = css.indexOf(START);
  const b = css.indexOf(END);
  if (a < 0 || b < 0) throw new Error("tokens.css 에 생성 구간 표시가 없어요");
  return css.slice(0, a) + generated + css.slice(b + END.length);
}

// ── 명령줄 ──
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = new URL("../", import.meta.url);
  const tokens = JSON.parse(readFileSync(new URL("tokens.json", root), "utf8")) as Json;
  const bad = checkAliases(tokens);
  if (bad.length) {
    console.error("없는 토큰을 가리키는 별칭:\n" + bad.join("\n"));
    process.exit(1);
  }
  const file = new URL("src/tokens.css", root);
  const css = readFileSync(file, "utf8");
  const next = replaceGenerated(css, generateCss(tokens));
  if (process.argv.includes("--check")) {
    if (next !== css) {
      console.error("src/tokens.css 가 tokens.json 과 달라요 — `npm run tokens` 를 실행하세요.");
      process.exit(1);
    }
    console.log("tokens.css 최신");
  } else {
    writeFileSync(file, next);
    console.log(`tokens.css 생성 — 토큰 ${flatten(tokens).length}개`);
  }
}
