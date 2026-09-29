// 디자인 토큰 — tokens.json ↔ src/tokens.css 가 맞는지, styles.css 가 값을 직접 쓰지 않는지

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkAliases, cssName, cssValue, END, flatten, generateCss, START } from "../scripts/tokens";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = JSON.parse(read("tokens.json")) as Record<string, unknown>;
const tokensCss = read("src/tokens.css");
const stylesCss = read("src/styles.css");
const noComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("tokens.json (Figma Variables 원본)", () => {
  it("컬러 · 타이포 · 간격 · 모서리 그룹이 있고, 모든 토큰에 형식($type)이 있다", () => {
    for (const g of ["color", "typography", "spacing", "radius"]) expect(json[g], g).toBeTruthy();
    const flat = flatten(json);
    expect(flat.length).toBeGreaterThan(100);
    for (const t of flat) expect(["color", "number", "fontFamily"]).toContain(t.type);
  });

  it("별칭({color.grey.100})은 모두 있는 토큰을 가리킨다", () => {
    expect(checkAliases(json)).toEqual([]);
  });

  it("색은 #rrggbb / #rrggbbaa, 숫자는 숫자", () => {
    for (const t of flatten(json)) {
      if (typeof t.value === "string" && t.value.startsWith("{")) continue;
      if (t.type === "color") expect(t.value, t.path.join(".")).toMatch(/^#([0-9a-f]{6}|[0-9a-f]{8})$/);
      if (t.type === "number") expect(typeof t.value, t.path.join(".")).toBe("number");
    }
  });
});

describe("tokens.json → CSS 변수", () => {
  it("이름 규칙", () => {
    expect(cssName(["color", "grey", "100"])).toBe("--color-grey-100");
    expect(cssName(["color", "text", "default"])).toBe("--color-text");
    expect(cssName(["typography", "font-size", "12-5"])).toBe("--font-size-12-5");
    expect(cssName(["spacing", "8"])).toBe("--space-8");
  });

  it("값 변환: 투명도 색 · 행간(%) · 자간(%) · px · 별칭", () => {
    expect(cssValue({ path: ["color", "x"], type: "color", value: "#191f28b8" })).toBe("rgba(25, 31, 40, 0.72)");
    expect(cssValue({ path: ["typography", "line-height", "150"], type: "number", value: 150 })).toBe("1.5");
    expect(cssValue({ path: ["typography", "letter-spacing", "snug"], type: "number", value: -1 })).toBe("-0.01em");
    expect(cssValue({ path: ["spacing", "8"], type: "number", value: 8 })).toBe("8px");
    expect(cssValue({ path: ["color", "bg"], type: "color", value: "{color.grey.100}" })).toBe("var(--color-grey-100)");
  });

  it("src/tokens.css 의 생성 구간이 tokens.json 과 같다 (다르면 `npm run tokens`)", () => {
    const a = tokensCss.indexOf(START);
    const b = tokensCss.indexOf(END);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(tokensCss.slice(a, b + END.length)).toBe(generateCss(json));
  });
});

describe("styles.css 는 토큰만 쓴다", () => {
  const body = noComments(stylesCss);
  const decls = [...body.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({ prop: m[1], value: m[2].trim() }));

  it("쓰는 var(--…) 는 모두 tokens.css 에 정의돼 있다", () => {
    const defined = new Set([...tokensCss.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = new Set([...(stylesCss + tokensCss).matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    expect([...used].filter((v) => !defined.has(v))).toEqual([]);
  });

  it("색 값(#hex · rgb())을 직접 쓰지 않는다", () => {
    const bad = decls.filter((d) => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(d.value));
    expect(bad).toEqual([]);
  });

  it("글자 크기 · 굵기 · 간격 · 모서리 · 그림자 · z-index 를 직접 쓰지 않는다", () => {
    const bad = decls.filter(({ prop, value }) => {
      if (prop === "font-size" || prop === "font-weight" || prop === "z-index") return !/^var\(|^inherit$/.test(value);
      if (/^(padding|margin)(-|$)|^(row-|column-)?gap$/.test(prop)) return /\d+px/.test(value.replace(/var\([^)]*\)/g, ""));
      if (/radius$/.test(prop)) return /\d+(px|%)/.test(value.replace(/var\([^)]*\)/g, ""));
      if (prop === "box-shadow" || prop === "text-shadow") return !/^(none|var\(--[a-z0-9-]+\))(\s*!important)?$/.test(value);
      return false;
    });
    expect(bad).toEqual([]);
  });

  it("예전 변수 이름(--grey-100, --text 등)이 남아 있지 않다", () => {
    expect(stylesCss.match(/var\(--(?:blue|grey|red|green|orange|yellow)-\d+\)|var\(--(?:bg|panel|panel-2|line|line-2|text|text-2|muted|faint|primary|accent|sel|radius|shadow|shadow-lg|ring)\)/g)).toBeNull();
  });
});
