// 업데이트 기록 — CHANGELOG.md 와 package.json 버전이 맞는지, 앱에 보일 형식인지, 안 본 소식 계산

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION, CHANGELOG, compareVersions, formatUpdateDate, parseChangelog, unseenVersions } from "../src/lib/changelog";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

describe("CHANGELOG.md 규칙 (CLAUDE.md)", () => {
  it("맨 위 항목 버전 = package.json 버전 = 앱에 보이는 버전", () => {
    expect(CHANGELOG.length).toBeGreaterThan(0);
    expect(CHANGELOG[0].version).toBe(pkg.version);
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("버전은 위로 갈수록 크고(중복 없음), 날짜는 거꾸로 가지 않는다", () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version), `${CHANGELOG[i - 1].version} > ${CHANGELOG[i].version}`).toBeGreaterThan(0);
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date).toBe(true);
    }
  });

  it("모든 항목에 날짜 · 한 줄 요약 · 바뀐 점이 있다", () => {
    for (const e of CHANGELOG) {
      expect(Number.isNaN(Date.parse(e.date)), e.version).toBe(false);
      expect(e.title.length, e.version).toBeGreaterThan(0);
      expect(e.items.length, e.version).toBeGreaterThan(0);
    }
  });
});

describe("parseChangelog", () => {
  const md = `# 업데이트 기록

소개 글은 무시

## 1.2.0 — 2026-10-01
### 새 기능
- 첫째
- 둘째가
  이어지는 줄

## [1.1.1] - 2026-09-30
- 제목 없는 항목
`;
  it("버전 · 날짜 · 제목 · 항목 (여러 줄 항목, 대괄호 · 하이픈 형식도)", () => {
    expect(parseChangelog(md)).toEqual([
      { version: "1.2.0", date: "2026-10-01", title: "새 기능", items: ["첫째", "둘째가 이어지는 줄"] },
      { version: "1.1.1", date: "2026-09-30", title: "제목 없는 항목", items: ["제목 없는 항목"] },
    ]);
  });

  it("버전 비교는 자리별 숫자로 (0.10.0 > 0.9.0)", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("날짜 표시: 올해는 월·일만", () => {
    expect(formatUpdateDate("2026-09-29", new Date(2026, 0, 1))).toBe("9월 29일");
    expect(formatUpdateDate("2025-12-01", new Date(2026, 0, 1))).toBe("2025년 12월 1일");
  });
});

describe("안 본 소식", () => {
  const entries = parseChangelog(`## 0.3.0 — 2026-10-02
- c
## 0.2.0 — 2026-09-29
- b
## 0.1.0 — 2026-09-01
- a
`);
  it("본 기록이 있으면 그 밖의 버전만 새 소식", () => {
    expect([...unseenVersions(entries, ["0.1.0", "0.2.0"])]).toEqual(["0.3.0"]);
  });
  it("처음 보는 브라우저: 가입한 날까지 나온 소식은 본 것으로", () => {
    expect([...unseenVersions(entries, null, new Date(2026, 8, 29, 15).getTime())]).toEqual(["0.3.0"]);
    expect([...unseenVersions(entries, null, new Date(2026, 7, 1).getTime())]).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  });
  it("가입 시각을 모르면 새 소식 없음", () => {
    expect(unseenVersions(entries, null).size).toBe(0);
  });
});
