// 문서 활동 기록 — 한 번의 변경(트랜잭션)에서 바뀐 곳을 "타이틀 수정" · "이미지 위치 변경" 같은 말로 바꾼다.
// 지워진 요소 · 페이지의 이름은 지워지기 전 색인(LabelIndex)에서 찾는다.

import type * as Y from "yjs";
import { pageToJson, yElements, yPages, type ChangeRef } from "../../shared/collab";
import type { DocActivityItem, PageElement, TextRole } from "../../shared/types";

const ROLE_LABEL: Record<TextRole, string> = {
  title: "타이틀",
  subtitle: "서브타이틀",
  highlight: "하이라이트",
  body: "본문",
  label: "칩 라벨",
  section: "섹션 라벨",
  caption: "캡션",
  footer: "하단 문구",
  free: "텍스트",
};

const KIND_LABEL: Record<string, string> = {
  case: "케이스 페이지",
  reference: "레퍼런스 페이지",
  cover: "표지",
  section: "간지",
  blank: "빈 페이지",
  toc: "목차",
  compare: "비교 페이지",
  closing: "마무리 페이지",
};

export function elementLabel(el: Pick<PageElement, "type"> & Partial<{ role: TextRole; logo: boolean; shape: string }>): string {
  if (el.type === "text") return ROLE_LABEL[el.role ?? "free"] ?? "텍스트";
  if (el.type === "image") return el.logo ? "로고" : "이미지";
  return el.shape === "line" ? "선" : "도형";
}

const POS = new Set(["x", "y"]);
const SIZE = new Set(["w", "h"]);
const STYLE = new Set(["style", "captionStyle", "fill", "stroke", "strokeWidth", "radius", "opacity", "rotation", "fit", "focusX", "focusY"]);
const CAPTION = new Set(["caption", "captionPos"]);

function elementAction(keys: Set<string>): string {
  const has = (set: Set<string>) => [...keys].some((k) => set.has(k));
  if (keys.has("text")) return "수정";
  if (keys.has("src")) return "교체";
  if (has(POS) && has(SIZE)) return "위치 · 크기 변경";
  if (has(POS)) return "위치 변경";
  if (has(SIZE)) return "크기 변경";
  if (has(CAPTION)) return "캡션 수정";
  if (has(STYLE)) return "스타일 변경";
  if (keys.has("z") && keys.size === 1) return "순서 변경";
  if (keys.has("locked")) return "잠금 변경";
  return "수정";
}

function pageAction(keys: Set<string>): string {
  if (keys.has("o") && keys.size === 1) return "순서 변경";
  if (keys.has("layout") || keys.has("area")) return "이미지 배치 변경";
  if (keys.has("flow")) return "글 배치 변경";
  if (keys.has("background") || keys.has("hideFooter")) return "스타일 변경";
  return "수정";
}

/** 요소 · 페이지 이름 색인 — 지워진 뒤에도 무엇이 지워졌는지 말할 수 있게 */
export class LabelIndex {
  elements = new Map<string, { pageId: string; label: string }>();
  pages = new Map<string, string>();

  constructor(private doc: Y.Doc) {
    for (const id of yPages(doc).keys()) this.refreshPage(id);
  }

  refreshPage(pageId: string) {
    const yp = yPages(this.doc).get(pageId);
    if (!yp) {
      this.pages.delete(pageId);
      return;
    }
    const page = pageToJson(pageId, yp);
    this.pages.set(pageId, page.group ? `${KIND_LABEL[page.kind] ?? "페이지"}(${page.group})` : (KIND_LABEL[page.kind] ?? "페이지"));
    for (const el of page.elements) this.elements.set(el.id, { pageId, label: elementLabel(el as never) });
  }

  /** 변경 뒤에 — 바뀐 페이지의 이름을 새로 하고, 없어진 요소는 지운다 */
  refresh(changes: ChangeRef[]) {
    const pages = new Set(changes.map((c) => c.pageId).filter((x): x is string => !!x));
    for (const id of pages) this.refreshPage(id);
    for (const c of changes) {
      if (!c.elementId) continue;
      const at = this.elements.get(c.elementId);
      const yp = at && yPages(this.doc).get(at.pageId);
      if (!yp || !yElements(yp)?.has(c.elementId)) this.elements.delete(c.elementId);
    }
  }
}

/**
 * 바뀐 곳 → 페이지별 활동 항목. 같은 요소의 여러 속성은 한 항목으로, 다른 페이지로 옮긴 요소는 양쪽에 '이동'으로.
 * (pageId null = 문서 제목 · 양식 · 보관함)
 */
export function describeChanges(doc: Y.Doc, changes: ChangeRef[], index: LabelIndex): Map<string | null, DocActivityItem[]> {
  const out = new Map<string | null, DocActivityItem[]>();
  const push = (pageId: string | null, item: DocActivityItem) => {
    if (!out.has(pageId)) out.set(pageId, []);
    out.get(pageId)!.push(item);
  };
  const pages = yPages(doc);
  const exists = (pageId: string, elId: string) => {
    const yp = pages.get(pageId);
    return !!yp && !!yElements(yp)?.has(elId);
  };

  // 요소별로 모으기
  const els = new Map<string, { pageId: string; keys: Set<string>; added: boolean; removed: boolean }>();
  const added = new Map<string, string>(); // 요소 → 들어간 페이지
  const removed = new Map<string, string>(); // 요소 → 빠진 페이지
  const pageKeys = new Map<string, Set<string>>();
  const pagesAddedRemoved = new Map<string, boolean>();
  let meta = false;
  let settings = false;
  let tray = false;

  for (const c of changes) {
    if (c.kind === "meta") meta = true;
    else if (c.kind === "settings") settings = true;
    else if (c.kind === "tray") tray = true;
    else if (c.kind === "page" && c.pageId) {
      if (!c.key) pagesAddedRemoved.set(c.pageId, pages.has(c.pageId));
      else if (c.key !== "elements") {
        if (!pageKeys.has(c.pageId)) pageKeys.set(c.pageId, new Set());
        pageKeys.get(c.pageId)!.add(c.key);
      }
    } else if (c.kind === "element" && c.pageId && c.elementId) {
      if (!c.key) {
        if (exists(c.pageId, c.elementId)) added.set(c.elementId, c.pageId);
        else removed.set(c.elementId, c.pageId);
      } else {
        const e = els.get(c.elementId) ?? { pageId: c.pageId, keys: new Set<string>(), added: false, removed: false };
        e.keys.add(c.key);
        els.set(c.elementId, e);
      }
    }
  }

  for (const [pageId, nowExists] of pagesAddedRemoved) {
    const label = index.pages.get(pageId) ?? "페이지";
    push(pageId, { label, action: nowExists ? "추가" : "삭제" });
  }
  for (const [pageId, keys] of pageKeys) {
    if (pagesAddedRemoved.has(pageId)) continue;
    push(pageId, { label: index.pages.get(pageId) ?? "페이지", action: pageAction(keys) });
  }

  const labelOf = (elId: string, pageId: string) => {
    const yp = pages.get(pageId);
    const ye = yp && yElements(yp)?.get(elId);
    if (ye) return elementLabel({ type: ye.get("type"), role: ye.get("role"), logo: ye.get("logo"), shape: ye.get("shape") } as never);
    return index.elements.get(elId)?.label ?? "요소";
  };

  for (const [elId, pageId] of added) {
    if (pagesAddedRemoved.has(pageId)) continue;
    const from = removed.get(elId);
    if (from && from !== pageId) push(pageId, { el: elId, label: labelOf(elId, pageId), action: "옮겨 옴" });
    else if (!from) push(pageId, { el: elId, label: labelOf(elId, pageId), action: "추가" });
  }
  for (const [elId, pageId] of removed) {
    if (pagesAddedRemoved.has(pageId)) continue;
    const to = added.get(elId);
    if (to && to !== pageId) push(pageId, { el: elId, label: index.elements.get(elId)?.label ?? labelOf(elId, to), action: "다른 페이지로 옮김" });
    else if (!to) push(pageId, { el: elId, label: index.elements.get(elId)?.label ?? "요소", action: "삭제" });
  }
  for (const [elId, e] of els) {
    if (added.has(elId) || removed.has(elId) || pagesAddedRemoved.has(e.pageId)) continue;
    push(e.pageId, { el: elId, label: labelOf(elId, e.pageId), action: elementAction(e.keys) });
  }

  if (meta) push(null, { label: "문서 제목", action: "수정" });
  if (settings) push(null, { label: "문서 양식", action: "변경" });
  if (tray) push(null, { label: "임시 보관함", action: "변경" });
  return out;
}
