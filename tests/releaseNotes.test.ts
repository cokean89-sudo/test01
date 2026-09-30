// 고객용 업데이트 소식(RELEASE_NOTES.md) 규칙 — 앱 화면은 이 파일만 읽는다

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, compareVersions, parseChangelog } from "../src/lib/changelog";
import { RELEASE_NOTES, STABILITY_NOTE } from "../src/lib/releaseNotes";

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const CHANGELOG = parseChangelog(read("CHANGELOG.md"));

/** 소식에 쓰지 않는 말 — 기술 용어 · 내부 구조 · 디자인 도구 */
const FORBIDDEN = [
  "서버",
  "R2",
  "S3",
  "HTML",
  "CSS",
  "JSON",
  "API",
  "토큰",
  "WebP",
  "EXIF",
  "DB",
  "데이터베이스",
  "저장소",
  "Figma",
  "피그마",
  "디자인 도구",
  "보안",
  "환경변수",
  "마이그레이션",
  "배포",
  "모델",
  "캐시",
  "예산",
];

describe("RELEASE_NOTES.md (고객용 소식)", () => {
  it("앱이 읽는 소식 = 이 파일", () => {
    expect(RELEASE_NOTES).toEqual(parseChangelog(read("RELEASE_NOTES.md")));
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
  });

  it("제목 1줄 + 설명 1~3줄. 버그 수정만 있는 버전은 '사용성과 안정성을 개선했어요' 한 줄", () => {
    for (const e of RELEASE_NOTES) {
      expect(e.title.length, e.version).toBeGreaterThan(0);
      expect(e.title, e.version).not.toMatch(/\n/);
      expect(e.items.length, e.version).toBeLessThanOrEqual(3);
      if (e.items.length === 0) expect(e.title, `${e.version}: 설명이 없으면 안정성 한 줄만`).toBe(STABILITY_NOTE);
    }
  });

  it("기술 용어 · 내부 구조는 쓰지 않는다", () => {
    for (const e of RELEASE_NOTES) {
      const text = [e.title, ...e.items].join(" ");
      for (const w of FORBIDDEN) expect(text.includes(w), `${e.version}: '${w}'`).toBe(false);
    }
  });

  it("버전 · 날짜는 개발 기록(CHANGELOG.md)의 같은 버전과 맞고, 최신이 위", () => {
    const dev = new Map(CHANGELOG.map((e) => [e.version, e.date]));
    for (const e of RELEASE_NOTES) expect(dev.get(e.version), `${e.version} 이 CHANGELOG 에 있어야 해요`).toBe(e.date);
    for (let i = 1; i < RELEASE_NOTES.length; i++) expect(compareVersions(RELEASE_NOTES[i - 1].version, RELEASE_NOTES[i].version)).toBeGreaterThan(0);
    expect(compareVersions(APP_VERSION, RELEASE_NOTES[0].version)).toBeGreaterThanOrEqual(0);
  });

  it("사용자에게 보이는 변화가 없던 버전(0.8.2 디자인 정리)은 소식이 없다", () => {
    expect(RELEASE_NOTES.map((e) => e.version)).not.toContain("0.8.2");
  });

  it("앱 화면 코드는 개발 기록을 읽지 않는다", () => {
    for (const f of ["src/lib/changelog.ts", "src/lib/releaseNotes.ts", "src/components/Updates.tsx", "src/store/updates.ts", "src/views/auth/AuthViews.tsx"]) {
      expect(read(f), f).not.toMatch(/CHANGELOG\.md\?raw/);
    }
  });
});
