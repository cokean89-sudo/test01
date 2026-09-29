// AI 글쓰기 프롬프트·모델 옵션 — API 호출 없이 검사한다
import { describe, expect, it } from "vitest";
import { heuristicAnalysis, modelOptions, PERSPECTIVE_GUIDE, systemPrompt } from "../server/ai";

describe("AI 글쓰기 프롬프트", () => {
  it("보고체가 기본 — 명사형 종결을 지시하고 '~이다/~한다'로 쓰라는 지시는 없다", () => {
    const p = systemPrompt("ko");
    expect(p).toMatch(/명사형/);
    expect(p).toMatch(/~표현\. \/ ~상징\. \/ ~의미\. \/ ~구성\. \/ ~강조\. \/ ~전달\./);
    expect(p).not.toMatch(/'~이다\/~한다'로 끝나는/);
    expect(p).toMatch(/'~이다', '~한다'.*끝내지 않는다/);
  });

  it("추측 표현 금지 · 확인 불가 수치 금지 · 한 문장 한 정보", () => {
    const p = systemPrompt("ko", "fact");
    expect(p).toMatch(/추측 표현/);
    expect(p).toMatch(/확인할 수 없는 수치·연도/);
    expect(p).toMatch(/한 문장에 정보 하나/);
  });

  it("관점마다 초점과 좋은 예시 1~2개가 들어간다", () => {
    for (const key of ["design", "planning", "fact"] as const) {
      const guide = PERSPECTIVE_GUIDE[key];
      expect(guide.examples.report.length).toBeGreaterThanOrEqual(1);
      expect(guide.examples.report.length).toBeLessThanOrEqual(2);
      const p = systemPrompt("ko", key);
      expect(p).toContain(guide.label);
      for (const ex of guide.examples.report) expect(p).toContain("좋은 예: " + ex);
      // 보고체 예시는 모두 명사형 종결
      for (const ex of guide.examples.report) expect(ex).not.toMatch(/다\.$/);
    }
  });

  it("서술체를 고르면 평서문 지시와 서술체 예시를 쓴다", () => {
    const p = systemPrompt("ko", "design", "sentence");
    expect(p).toMatch(/서술체/);
    expect(p).toContain(PERSPECTIVE_GUIDE.design.examples.sentence[0]);
  });

  it("AI 가 없을 때의 기본 문구도 명사형", () => {
    const r = heuristicAnalysis({ kind: "reference", language: "ko", group: "조명", images: [{ url: "x", tags: ["야간조명"] }] });
    expect(r.description).toMatch(/정리\./);
    expect(r.description).not.toMatch(/하였다|이다\./);
  });
});

describe("모델별 요청 옵션", () => {
  it("Opus 5.5 는 adaptive thinking + 서버 측 대체 모델, Haiku 4.5 는 둘 다 끈다", () => {
    expect(modelOptions("claude-opus-5-5")).toEqual({ adaptive: true, fallback: true });
    expect(modelOptions("claude-sonnet-5-5")).toEqual({ adaptive: true, fallback: true });
    expect(modelOptions("claude-haiku-4-5")).toEqual({ adaptive: false, fallback: false });
    expect(modelOptions("claude-opus-4-8")).toEqual({ adaptive: true, fallback: false });
  });
});
