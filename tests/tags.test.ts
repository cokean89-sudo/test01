import { describe, expect, it } from "vitest";
import { canonicalTag, flattenAxes, isBannedTag, refineAxes, similarGroups, tagKey } from "../shared/tags";

describe("태그 규칙", () => {
  it("금지어·숫자만·1글자·사이트 흔적은 거른다", () => {
    for (const bad of ["pinterest", "Pin", "image", "JPG", "png", "www", "com", "2024", "1200x800", "빛", "a", "https://x.com", "이미지", "#pinterest"]) {
      expect(isBannedTag(bad), bad).toBe(true);
    }
    for (const ok of ["야간조명", "ETFE", "스타디움", "F&B", "레드", "미디어파사드"]) expect(isBannedTag(ok), ok).toBe(false);
  });

  it("띄어쓰기·대소문자·하이픈만 다르면 같은 태그로 보고 기존 표기를 쓴다", () => {
    expect(tagKey("야간 조명")).toBe(tagKey("야간조명"));
    expect(tagKey("Night-Light")).toBe(tagKey("night light"));
    expect(canonicalTag("야간 조명", ["야간조명", "레드"])).toBe("야간조명");
    expect(canonicalTag("새태그", ["야간조명"])).toBe("새태그");
  });

  it("AI 제안 후처리: 금지어 제거, 기존 표기 재사용, 이미 붙은 태그·축 간 중복 제거, 축별 최대 2개", () => {
    const axes = refineAxes(
      {
        field: ["스포츠", "pinterest"],
        subject: ["스타디움", "stadium", "경기장", "구장"],
        element: ["야간 조명"],
        material: ["ETFE"],
        color: ["레드", "레드"],
        mood: ["2024"],
      },
      ["야간조명", "Stadium"],
      ["스타디움"],
    );
    expect(axes.field).toEqual(["스포츠"]);
    // '스타디움'은 이미 붙어 있고, 'stadium'은 기존 표기 'Stadium'으로
    expect(axes.subject).toEqual(["Stadium", "경기장"]);
    expect(axes.element).toEqual(["야간조명"]);
    expect(axes.color).toEqual(["레드"]);
    expect(axes.mood).toEqual([]);
    expect(flattenAxes(axes)).toEqual(["스포츠", "Stadium", "경기장", "야간조명", "ETFE", "레드"]);
  });

  it("비슷한 태그 묶기", () => {
    expect(similarGroups(["야간조명", "야간 조명", "레드", "Red", "red", "굿즈"])).toEqual([
      ["야간조명", "야간 조명"],
      ["Red", "red"],
    ]);
  });
});
