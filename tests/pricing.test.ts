// AI 예상 비용 계산 · 한국 시간 월/일 경계 · 한도 문구 조사
import { afterEach, describe, expect, it } from "vitest";
import { costUsd, priceOf } from "../server/pricing";
import { dayKey, monthKey, nextMonthStart } from "../server/usage";
import { monthDayLabel, usageState, withObject } from "../shared/usage";

afterEach(() => {
  delete process.env.AI_PRICES;
});

describe("AI 예상 비용", () => {
  it("모델별 단가 × 토큰 (캐시 쓰기 5분 · 1시간, 캐시 읽기 포함)", () => {
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 0 })).toBe(4);
    expect(costUsd("claude-opus-5-5", { input: 0, output: 1_000_000 })).toBe(20);
    expect(costUsd("claude-opus-5-5", { input: 2000, output: 500 })).toBe(0.018);
    expect(costUsd("claude-haiku-4-5", { input: 1000, output: 200, cacheRead: 500 })).toBe(0.00205);
    expect(costUsd("claude-sonnet-5-5", { input: 0, output: 0, cacheWrite5m: 1_000_000, cacheWrite1h: 1_000_000 })).toBe(6.5);
  });

  it("날짜가 붙은 모델 이름은 기본 이름 단가, 모르는 모델은 기본 단가(비싼 쪽)로", () => {
    expect(priceOf("claude-haiku-4-5-20251001")).toEqual(priceOf("claude-haiku-4-5"));
    expect(priceOf("claude-opus-5-5-20260101").input).toBe(4); // claude-opus-5 가 아니라 더 긴 이름에 맞춘다
    expect(priceOf("claude-opus-5-20260101").input).toBe(5);
    expect(priceOf("unknown-model").output).toBe(50);
  });

  it("AI_PRICES 환경변수로 단가를 바꿀 수 있다", () => {
    process.env.AI_PRICES = JSON.stringify({ "claude-opus-5-5": { input: 1, cacheWrite5m: 1, cacheWrite1h: 1, cacheRead: 1, output: 1 } });
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 1_000_000 })).toBe(2);
    delete process.env.AI_PRICES;
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 0 })).toBe(4);
  });
});

describe("한국 시간 기준 월 · 일", () => {
  it("9월 30일 23:59(KST)는 9월, 10월 1일 0:00(KST)부터 10월", () => {
    const lastMinute = Date.parse("2026-09-30T14:59:00Z"); // KST 23:59
    const firstMinute = Date.parse("2026-09-30T15:00:00Z"); // KST 10-01 00:00
    expect(monthKey(lastMinute)).toBe("2026-09");
    expect(dayKey(lastMinute)).toBe("2026-09-30");
    expect(monthKey(firstMinute)).toBe("2026-10");
    expect(dayKey(firstMinute)).toBe("2026-10-01");
  });

  it("다시 채워지는 날: 다음 달 1일 0시(KST), 연말은 다음 해 1월", () => {
    expect(nextMonthStart(Date.parse("2026-09-15T03:00:00Z"))).toEqual({ date: "2026-10-01", ts: Date.parse("2026-09-30T15:00:00Z"), label: "10월 1일" });
    expect(nextMonthStart(Date.parse("2026-12-31T16:00:00Z")).label).toBe("2월 1일"); // KST 2027-01-01 01:00
    expect(nextMonthStart(Date.parse("2026-12-31T10:00:00Z")).date).toBe("2027-01-01");
  });
});

describe("한도 문구", () => {
  it("받침에 맞는 조사", () => {
    expect(withObject("AI 글쓰기")).toBe("AI 글쓰기를");
    expect(withObject("AI 태그 제안")).toBe("AI 태그 제안을");
    expect(withObject("AI")).toBe("AI를");
    expect(monthDayLabel("2026-10-01")).toBe("10월 1일");
  });

  it("80% 부터 안내, 100% 면 다 씀, 한도 없음(관리자)은 항상 여유", () => {
    expect(usageState(39, 50)).toBe("ok");
    expect(usageState(40, 50)).toBe("warn");
    expect(usageState(50, 50)).toBe("full");
    expect(usageState(0, 0)).toBe("full");
    expect(usageState(999, null)).toBe("ok");
  });
});
