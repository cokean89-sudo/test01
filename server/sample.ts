// 첫 실행 체험용 샘플 데이터 — 첨부 예시(케이스 스터디 / 구장 조형물 아이데이션)를 플레이스홀더 이미지로 재현.

import crypto from "node:crypto";
import type { CaseStudy, Reference } from "../shared/types";

const SIZES: Record<string, [number, number]> = {
  "arena-night": [1200, 571],
  "arena-stands": [1200, 1935],
  "arena-aerial": [1200, 706],
  "arena-tricolor": [1200, 1143],
  "arena-museum": [1200, 1154],
  "arena-bowl": [1200, 706],
  "arena-store": [1200, 706],
  "arena-tour": [1200, 706],
  "logo-stadium": [1200, 750],
  "logo-crest": [1200, 1200],
  "star-stardust": [1200, 902],
  "star-marquee": [1200, 896],
  "star-arrow-day": [1200, 1818],
  "star-arrow-night": [1200, 1818],
  "star-shooting": [1200, 571],
  "star-gate": [1200, 600],
  "star-tower": [1200, 1200],
  "star-wire": [1200, 1395],
  "star-street": [1200, 1395],
};

export function sampleData(): { cases: CaseStudy[]; references: Reference[] } {
  const now = Date.now();
  const arena: CaseStudy = {
    id: "c" + crypto.randomUUID().replaceAll("-", "").slice(0, 12),
    name: "Allianz Arena",
    subtitle: "Bundesliga-FC Bayern München",
    highlight: "스폰서 : Allianz AG (보험/금융) / 소유: Allianz AG",
    description:
      "알리안츠 아레나는 독일 뮌헨에 있는 경기장으로 국제 축구 연맹(FIFA)은 경기장 명명권 계약을 허용하지 않기 때문에 2006년 FIFA 월드컵에서는 뮌헨 월드컵 경기장(FIFA World Cup Stadium Munich)이었다. 경기장 외견 색을 자유자재로 바꿀 수 있는 세계 유일의 경기장이며 독특한 모양새는 “고무보트(Schlauchboot)”라는 별명을 낳았다. 경기장 수용인원은 77,000 명이며, 300평 규모의 구단 메가스토어를 운영중이다.",
    tags: ["스타디움", "분데스리가", "명명권"],
    createdAt: now,
  };

  let t = now;
  const ref = (
    file: string,
    title: string,
    tags: string[],
    extra: Partial<Reference> = {},
  ): Reference => {
    const [width, height] = SIZES[file];
    return {
      id: "r" + crypto.randomUUID().replaceAll("-", "").slice(0, 12),
      imageUrl: `/samples/${file}.svg`,
      title,
      tags,
      kind: "image",
      width,
      height,
      source: "sample",
      createdAt: t--,
      ...extra,
    };
  };

  const references: Reference[] = [
    ref("logo-stadium", "Stadium Logo", ["로고"], { kind: "logo", logoLabel: "Stadium Logo", caseId: arena.id }),
    ref("logo-crest", "Team Logo", ["로고"], { kind: "logo", logoLabel: "Team Logo", caseId: arena.id }),
    ref("arena-night", "야간 파사드 조명", ["야간조명", "파사드", "스타디움"], { caseId: arena.id }),
    ref("arena-stands", "관중석 · 레드 조명 링", ["관중석", "스타디움", "야간조명"], { caseId: arena.id }),
    ref("arena-aerial", "항공 뷰 · 화이트 외관", ["파사드", "스타디움"], { caseId: arena.id }),
    ref("arena-tricolor", "국가색 라이트쇼", ["야간조명", "라이트쇼", "파사드"], { caseId: arena.id }),
    ref("arena-museum", "구단 박물관 복도", ["박물관", "전시"], { caseId: arena.id }),
    ref("arena-bowl", "경기장 내부 전경", ["관중석", "스타디움"], { caseId: arena.id }),
    ref("arena-store", "메가스토어 유니폼 월", ["굿즈샵", "리테일"], { caseId: arena.id }),
    ref("arena-tour", "스타디움 투어 동선", ["투어", "체험"], { caseId: arena.id }),
    ref("star-stardust", "Stardust 네온 사인", ["조형물", "네온사인", "별"]),
    ref("star-marquee", "마키 조명 별 사인", ["조형물", "네온사인", "별"]),
    ref("star-arrow-day", "18b 아트 디스트릭트 사인 (주간)", ["조형물", "사인물"]),
    ref("star-arrow-night", "18b 아트 디스트릭트 사인 (야간)", ["조형물", "사인물", "야간조명"]),
    ref("star-shooting", "별똥별 라이팅 아치", ["조형물", "별", "야간조명"]),
    ref("star-gate", "별 모양 게이트 포토존", ["조형물", "별", "포토존"]),
    ref("star-tower", "별 조각 타워", ["조형물", "별"]),
    ref("star-wire", "와이어 스타 조형물", ["조형물", "별", "야간조명"]),
    ref("star-street", "가로등 별똥별 장식", ["조형물", "별", "사인물"]),
  ];
  return { cases: [arena], references };
}
