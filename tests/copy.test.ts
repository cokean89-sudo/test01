// 예시 문구 점검 — 경기장·스타디움 위주의 예시는 샘플 데이터(src/lib/dummy.ts)의 사례 1개에만 남긴다.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_CASES } from "../src/lib/dummy";

const root = path.resolve(import.meta.dirname, "..");
const STADIUM = /스타디움|경기장|야간조명|야간 조명|구단|리그|Allianz|[Ss]tadium|홈 팬|유니폼/;

function sources(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sources(rel);
    return /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

describe("예시 문구", () => {
  it("화면·서버·공용 코드에 경기장 위주 예시가 남아 있지 않다 (샘플 데이터 제외)", () => {
    const hits: string[] = [];
    for (const file of [...sources("src"), ...sources("shared"), ...sources("server")]) {
      if (file === path.join("src", "lib", "dummy.ts")) continue;
      fs.readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .forEach((line, i) => STADIUM.test(line) && hits.push(`${file}:${i + 1}: ${line.trim()}`));
    }
    expect(hits).toEqual([]);
  });

  it("샘플 사례: 브랜드 · 경쟁사 · 상품 + 경기장 1개", () => {
    const kinds = SAMPLE_CASES.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["brand", "competitor", "product"]));
    expect(SAMPLE_CASES.filter((c) => STADIUM.test(c.name + c.description + c.tags.join(" ")))).toHaveLength(1);
    for (const c of SAMPLE_CASES) {
      for (const img of c.images) expect(fs.existsSync(path.join(root, "public", img.src)), img.src).toBe(true);
    }
  });

  it("케이스 안내 문구", () => {
    const view = fs.readFileSync(path.join(root, "src/views/CasesView.tsx"), "utf8");
    expect(view).toContain("케이스는 하나의 사례(브랜드, 경쟁사, 상품 등)의 이미지·로고·설명을 묶는 단위예요.");
  });
});
