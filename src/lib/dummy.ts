// 템플릿 기본 더미 콘텐츠 — Lorem Ipsum 텍스트와 회색 박스 이미지 자리

import type { ImageElement, TextRole } from "../../shared/types";
import { uid } from "./id";

export const LOREM: Record<TextRole, string> = {
  title: "Lorem Ipsum",
  subtitle: "Dolor sit amet, consectetur",
  highlight: "Lorem ipsum : Dolor sit amet (consectetur) / Adipiscing: Elit",
  body:
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. " +
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  section: "Reference",
  label: "Lorem ipsum",
  caption: "Lorem ipsum dolor sit amet",
  footer: "Lorem ipsum",
  free: "Lorem ipsum dolor sit amet",
};

export function dummyText(role: TextRole): string {
  return LOREM[role];
}

/** 비어 있거나 Lorem Ipsum 더미 텍스트면 true — AI 가 채울 대상 */
export function isDummyText(text?: string): boolean {
  const s = (text ?? "").trim();
  return !s || /^(lorem ipsum|dolor sit amet)/i.test(s);
}

/** 템플릿 이미지 자리의 기본 비율 (모자이크에서 크고 작은 칸이 섞이도록) */
export const PLACEHOLDER_ASPECTS = [1.5, 0.75, 1.33, 1, 1.6, 0.8, 1.2, 1.5, 0.9];

/** 회색 박스로 표시되는 빈 이미지 자리 (src 없음). 더블클릭해서 라이브러리 이미지로 교체한다. */
export function placeholderImage(aspect: number, opts: { managed?: boolean; logo?: boolean } = {}): ImageElement {
  return {
    id: uid("i"),
    type: "image",
    src: "",
    natW: Math.round(aspect * 1000),
    natH: 1000,
    fit: opts.logo ? "contain" : "cover",
    managed: opts.managed ?? true,
    logo: opts.logo || undefined,
    caption: LOREM.caption,
    captionPos: "none",
    x: 0,
    y: 0,
    w: 120,
    h: 90,
  };
}
