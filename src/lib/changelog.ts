// 업데이트 기록 — 저장소 루트의 CHANGELOG.md 를 그대로 읽어 앱에 보여 준다 (원본은 그 파일 하나)
//
//   ## 0.8.0 — 2026-09-29      ← 버전 — 날짜
//   ### 한 줄 요약              ← 제목
//   - 쉬운 말로 쓴 바뀐 점       ← 항목

import raw from "../../CHANGELOG.md?raw";
import { version } from "../../package.json";

export interface ChangelogEntry {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  items: string[];
}

/** 지금 쓰고 있는 앱 버전 (package.json) */
export const APP_VERSION: string = version;

const HEAD = /^##\s+\[?v?(\d+\.\d+\.\d+)\]?\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;

export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  for (const line of md.split(/\r?\n/)) {
    const head = HEAD.exec(line.trim());
    if (head) {
      cur = { version: head[1], date: head[2], title: "", items: [] };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const t = line.trim();
    if (t.startsWith("### ")) {
      if (!cur.title) cur.title = t.slice(4).trim();
    } else if (/^[-*]\s+/.test(t)) {
      cur.items.push(t.replace(/^[-*]\s+/, ""));
    } else if (t && cur.items.length && /^\s{2,}\S/.test(line)) {
      // 들여쓴 줄은 앞 항목에 이어 붙인다
      cur.items[cur.items.length - 1] += " " + t;
    }
  }
  for (const e of out) if (!e.title) e.title = e.items[0] ?? `버전 ${e.version}`;
  return out;
}

export const CHANGELOG: ChangelogEntry[] = parseChangelog(raw);

/** a > b → 양수 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** 2026-09-29 → "9월 29일" (올해가 아니면 "2025년 9월 29일") */
export function formatUpdateDate(date: string, now = new Date()): string {
  const [y, m, d] = date.split("-").map(Number);
  return y === now.getFullYear() ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
}

function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 아직 안 본 버전들.
 * seen 이 없으면(이 브라우저에서 처음) 가입한 날까지 나온 소식은 본 것으로 친다 — 새로 온 사람에게 지난 기록 전체가 '새 소식'으로 뜨지 않게.
 */
export function unseenVersions(entries: ChangelogEntry[], seen: string[] | null, signedUpAt?: number): Set<string> {
  if (seen) return new Set(entries.filter((e) => !seen.includes(e.version)).map((e) => e.version));
  if (!signedUpAt) return new Set();
  const day = localDay(signedUpAt);
  return new Set(entries.filter((e) => e.date > day).map((e) => e.version));
}
