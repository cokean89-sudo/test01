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

// ─── 샘플 사례 (사용 가이드 예시) ─────────────────────────────
// 브랜드 · 경쟁사 · 상품 · 공간(경기장 1개) 사례. 브랜드명은 모두 가상의 예시이고,
// 이미지는 public/guide 에 직접 그린 일러스트다.

export type SampleKind = "brand" | "competitor" | "product" | "venue";

export interface SampleImage {
  key: string;
  src: string;
  w: number;
  h: number;
  title: string;
  tags: string[];
}

export interface SampleCase {
  id: string;
  kind: SampleKind;
  /** 사례 유형 이름 (브랜드 / 경쟁사 / 상품 / 공간) */
  label: string;
  name: string;
  subtitle: string;
  highlight: string;
  description: string;
  tags: string[];
  images: SampleImage[];
}

const img = (key: string, w: number, h: number, title: string, tags: string[]): SampleImage => ({ key, src: `/guide/${key}.svg`, w, h, title, tags });

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: "sample-brand",
    kind: "brand",
    label: "브랜드",
    name: "모닝루틴 성수 팝업",
    subtitle: "MORNING ROUTINE\nSeongsu Pop-up",
    highlight: "유형 : 브랜드 팝업 / 채널: 오프라인 · SNS",
    description:
      "가상 커피 브랜드의 팝업스토어 예시. 딥그린 파사드와 머스터드 포인트로 브랜드 컬러를 외관 전체에 적용.\n\n" +
      "* 쇼윈도 · 캠페인 포스터 · 굿즈까지 같은 컬러 시스템으로 방문 동선 구성.",
    tags: ["브랜드", "F&B", "팝업스토어"],
    images: [
      img("brand-popup", 1200, 900, "팝업스토어 외관", ["팝업스토어", "파사드", "딥그린"]),
      img("brand-window", 1000, 1000, "쇼윈도 디스플레이", ["쇼윈도", "디스플레이", "굿즈"]),
      img("brand-poster", 800, 1100, "캠페인 포스터", ["캠페인", "포스터", "그래픽"]),
    ],
  },
  {
    id: "sample-competitor",
    kind: "competitor",
    label: "경쟁사",
    name: "데일리브루 매장 · 매대",
    subtitle: "DAILY BREW\nStore & Shelf",
    highlight: "유형 : 경쟁사 / 비교 항목: 매장 메뉴 구성 · 편의점 매대",
    description:
      "가상 경쟁 브랜드의 매장과 편의점 매대 예시. 레드 · 블랙 고대비 컬러와 메뉴보드 중심의 매장 구성.\n\n" +
      "* 매대에서는 브랜드별 패키지 컬러 블록과 가격대 비교.",
    tags: ["경쟁사", "F&B", "리테일"],
    images: [
      img("competitor-store", 1200, 800, "경쟁사 매장 카운터", ["경쟁사", "매장", "메뉴보드"]),
      img("competitor-shelf", 1440, 810, "편의점 매대 진열", ["매대", "편의점", "가격비교"]),
    ],
  },
  {
    id: "sample-product",
    kind: "product",
    label: "상품",
    name: "콜드브루 원컵 라인업",
    subtitle: "COLD BREW\nProduct Line-up",
    highlight: "유형 : 상품 / 구성: 4종 (오리지널 · 밀크 · 베리 · 디카페인)",
    description:
      "가상 RTD 커피 상품의 패키지 예시. 병 형태와 캡 컬러를 통일하고 라벨 컬러로 맛 구분.\n\n" +
      "* 단품 병과 박스 세트를 같은 딥그린 톤으로 구성.",
    tags: ["상품", "패키지", "F&B"],
    images: [
      img("product-pack", 1000, 1000, "패키지 · 박스 세트", ["패키지", "병", "박스"]),
      img("product-lineup", 1400, 800, "맛별 라인업", ["라인업", "컬러코드", "패키지"]),
    ],
  },
  {
    id: "sample-venue",
    kind: "venue",
    label: "공간",
    name: "스타디움 야간 경관",
    subtitle: "Stadium\nNight Lighting",
    highlight: "유형 : 공간 / 요소: 외벽 조명 · 게이트 사인",
    description: "경기장 외벽 조명과 게이트 사인 예시. 외벽 전체를 단일 컬러 조명으로 연출하고 게이트에 같은 컬러의 사인 적용.",
    tags: ["공간", "스타디움"],
    images: [
      img("stadium-night", 1200, 800, "야간 외벽 조명", ["야간조명", "파사드"]),
      img("stadium-gate", 800, 1000, "게이트 사인", ["사인물", "게이트"]),
    ],
  },
];

export const SAMPLE_IMAGES: SampleImage[] = SAMPLE_CASES.flatMap((c) => c.images);

export function sampleCase(kind: SampleKind): SampleCase {
  return SAMPLE_CASES.find((c) => c.kind === kind)!;
}

export function sampleImage(key: string): SampleImage {
  return SAMPLE_IMAGES.find((i) => i.key === key)!;
}
