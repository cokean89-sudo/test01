// 템플릿 바꾸기 — 페이지마다 내용(글 · 이미지 · 로고 · 직접 추가한 요소)을 뽑아 새 템플릿 자리에 다시 넣는다.
// 템플릿 장식(deco)만 새로 그리고, 내용은 하나도 버리지 않는다.

import type { DocSettings, DocumentData, Page, PageLayout, TemplateId, TextElement } from "../../shared/types";
import { buildPage, emptyContent, tocEntries, tocTexts, type PageContent, type PageMeta } from "./templates";
import { compareItemCount } from "./themePages";
import { applyThemeSettings, themeLayout } from "./themes";

/** 역할로만 구분되던(슬롯이 없는) 예전 페이지 글 → 슬롯 */
const ROLE_SLOTS: Partial<Record<TextElement["role"], string>> = { title: "title", subtitle: "subtitle", highlight: "highlight", body: "body" };

/** 페이지에서 템플릿과 무관한 내용만 뽑는다 */
export function extractContent(page: Page): PageContent {
  const c = emptyContent();
  const labels = new Map<string, string>();
  for (const el of page.elements) if (el.type === "text" && el.labelFor) labels.set(el.labelFor, el.text);
  for (const el of page.elements) {
    if (el.deco) continue;
    if (el.type === "text") {
      if (el.labelFor) continue;
      const slot = el.slot ?? ROLE_SLOTS[el.role];
      if (slot && c.texts[slot] === undefined) c.texts[slot] = el.text;
      else c.extras.push(el);
    } else if (el.type === "image") {
      if (el.logo) c.logos.push({ img: el, label: labels.get(el.id) ?? "Logo" });
      else if (el.slot) c.slotImages[el.slot] = el;
      else if (el.managed) c.images.push(el);
      else c.extras.push(el);
    } else {
      c.extras.push(el);
    }
  }
  return c;
}

function sameLayout(a: PageLayout, b: PageLayout): boolean {
  const keys: (keyof PageLayout)[] = ["mode", "columns", "rows", "gap", "seed", "padX", "padY", "sizing", "alignX", "alignY"];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

/**
 * 한 페이지를 새 설정(템플릿)으로 다시 만든다.
 * 오토 레이아웃은 이전 템플릿 기본값 그대로였으면 새 템플릿 기본값으로, 직접 바꿨으면 그대로 둔다.
 */
export function rebuildPage(page: Page, from: DocSettings, to: DocSettings): Page {
  return rebuildWith(page, extractContent(page), from, to);
}

function rebuildWith(page: Page, content: PageContent, from: DocSettings, to: DocSettings): Page {
  const customLayout = !sameLayout(page.layout, themeLayout(from, page.kind));
  const meta: PageMeta = {
    id: page.id,
    group: page.group,
    caseId: page.caseId,
    notes: page.notes,
    layout: customLayout ? page.layout : undefined,
    flowMode: page.flow?.mode === "fixed" ? "auto" : page.flow?.mode,
    hideFooter: page.hideFooter,
    items: page.kind === "compare" ? compareItemCount(content, {}) : undefined,
  };
  return buildPage(page.kind, to, content, meta);
}

/** 문서 전체에 템플릿 적용 — 설정(여백 · 색 · 타이포)을 바꾸고 모든 페이지를 다시 만든다 */
export function applyTemplate(doc: DocumentData, id: TemplateId, accent?: string): DocumentData {
  const from = doc.settings;
  const to = applyThemeSettings(from, id, accent);
  let sectionNo = 0;
  const pages = doc.pages.map((p) => {
    const content = extractContent(p);
    if (p.kind === "section") {
      sectionNo++;
      // 기본 템플릿 간지에는 번호가 없으니, 번호 자리가 있는 템플릿으로 갈 때 순서대로 매긴다
      if (!content.texts.number?.trim() && id !== "default") content.texts.number = String(sectionNo).padStart(2, "0");
    }
    return rebuildWith(p, content, from, to);
  });
  return { ...doc, settings: to, pages };
}

/** 비교 페이지 항목 수(2~4) 바꾸기 — 남는 항목 내용은 빠진다 (되돌리기 가능) */
export function setCompareItems(page: Page, settings: DocSettings, items: number): Page {
  const content = extractContent(page);
  for (const k of Object.keys(content.texts)) {
    const m = /^cmp-(?:name|body)-(\d)$/.exec(k);
    if (m && Number(m[1]) >= items) delete content.texts[k];
  }
  for (const k of Object.keys(content.slotImages)) {
    const m = /^cmp-img-(\d)$/.exec(k);
    if (m && Number(m[1]) >= items) delete content.slotImages[k];
  }
  return buildPage("compare", settings, content, { id: page.id, group: page.group, notes: page.notes, layout: page.layout, hideFooter: page.hideFooter, items });
}

/** 목차 다시 만들기 — 지금 문서의 간지(없으면 케이스·레퍼런스·비교 페이지)로 */
export function refreshToc(page: Page, doc: DocumentData): Page {
  const content = extractContent(page);
  Object.assign(content.texts, tocTexts(tocEntries(doc.pages, doc.settings)));
  return buildPage("toc", doc.settings, content, { id: page.id, notes: page.notes, layout: page.layout, hideFooter: page.hideFooter });
}

/** 같은 템플릿으로 페이지만 다시 그리기 (쪽 크기 · 여백 변경 후 장식 위치 맞추기) */
export function redrawPage(page: Page, settings: DocSettings): Page {
  return rebuildPage(page, settings, settings);
}
