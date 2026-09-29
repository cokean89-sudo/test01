// 편집기 동작 — 도구 모음/단축키/인스펙터가 공통으로 호출한다.

import type {
  AiTextField,
  AnalyzeRequest,
  AnalyzeResult,
  CaptionPos,
  DocumentData,
  ImageElement,
  Page,
  PageElement,
  PageKind,
  PageLayout,
  Rect,
  Reference,
  TemplateId,
  TextElement,
  TextRole,
} from "../../../shared/types";
import { pageSize } from "../../components/PageView";
import { applyTemplate as applyTemplateToDoc, rebuildPage, redrawPage, refreshToc as refreshTocPage, setCompareItems as setCompareItemsOf } from "../../layout/switchTemplate";
import {
  createBlankPage,
  createCasePage,
  createClosingPage,
  createComparePage,
  createCoverPage,
  createReferencePage,
  createSectionPage,
  createTocPage,
  imageFromRef,
  relayoutPage as relayoutWith,
  scalePage,
  tocEntries,
} from "../../layout/templates";
import { setThemeAccent, themeOf } from "../../layout/themes";
import { dummyText, isDummyText } from "../../lib/dummy";
import { uid } from "../../lib/id";
import { parseQuery } from "../../lib/search";
import { useEditor, withPage } from "../../store/editor";
import { useLibrary } from "../../store/library";

const st = () => useEditor.getState();

/** 문서 타이포를 반영해 다시 배치 (글 길이 판단에 본문 크기·행간이 필요) */
function relayoutPage(page: Page): Page {
  return relayoutWith(page, st().doc?.settings);
}

export function getPage(doc: DocumentData | null, pageId: string | null): Page | undefined {
  return doc?.pages.find((p) => p.id === pageId);
}

export function selectedElements(): PageElement[] {
  const { doc, pageId, selection } = st();
  const page = getPage(doc, pageId);
  return page ? page.elements.filter((e) => selection.includes(e.id)) : [];
}

export function bbox(els: Rect[]): Rect {
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  const r = Math.max(...els.map((e) => e.x + e.w));
  const b = Math.max(...els.map((e) => e.y + e.h));
  return { x, y, w: r - x, h: b - y };
}

/** 글 배치(짧은 글/긴 글)를 따르는 요소인지 */
export function isFlowText(el: PageElement): boolean {
  return el.type === "text" && !el.labelFor && (el.role === "body" || el.role === "highlight");
}

/** 위치/크기를 직접 바꾸면 자동 레이아웃에서 분리한다 (피그마의 'Absolute position' 과 같음) */
function detachIfMoved(page: Page, el: PageElement, patch: Partial<PageElement>) {
  if (!["x", "y", "w", "h"].some((k) => k in patch)) return;
  if (el.type === "image" && (el.managed || el.logo)) {
    el.managed = false;
    el.logo = undefined;
  }
  if (page.flow && isFlowText(el)) page.flow.mode = "fixed";
}

export function patchElements(ids: string[], patch: Partial<PageElement> | ((el: PageElement) => Partial<PageElement>), key?: string) {
  const { pageId } = st();
  if (!pageId || !ids.length) return;
  st().update((d) => {
    withPage(d, pageId, (page) => {
      let reflow = false;
      for (const el of page.elements) {
        if (!ids.includes(el.id)) continue;
        const p = typeof patch === "function" ? patch(el) : patch;
        detachIfMoved(page, el, p);
        Object.assign(el, p);
        if ("text" in p && isFlowText(el) && page.flow?.mode === "auto") reflow = true;
      }
      // 본문 길이가 바뀌면 짧은 글/긴 글 배치를 다시 고른다
      if (reflow) return relayoutPage(page);
    });
  }, key ? { key } : undefined);
}

/** 글 배치 방식 변경 */
export function setTextFlow(pageId: string, mode: "auto" | "header" | "side") {
  updatePage(pageId, (page) => {
    if (!page.flow) return;
    page.flow = { ...page.flow, mode };
    return relayoutPage(page);
  });
}

export function updatePage(pageId: string, fn: (page: Page) => Page | void, key?: string) {
  st().update((d) => withPage(d, pageId, fn), key ? { key } : undefined);
}

export function addElement(el: PageElement, opts: { edit?: boolean } = {}) {
  const { pageId } = st();
  if (!pageId) return;
  st().update((d) => withPage(d, pageId, (page) => void page.elements.push(el)));
  st().select([el.id]);
  if (opts.edit) st().setEditing(el.id);
}

export function newText(rect: Rect, role: TextRole = "free", text = dummyText(role)): TextElement {
  return { id: uid("t"), type: "text", role, text, ...rect };
}

export function deleteSelection() {
  const { pageId, selection } = st();
  if (!pageId || !selection.length) return;
  st().update((d) =>
    withPage(d, pageId, (page) => {
      page.elements = page.elements.filter((e) => !selection.includes(e.id) && !(e.type === "text" && e.labelFor && selection.includes(e.labelFor)));
    }),
  );
  st().select([]);
}

function cloneForPaste(els: PageElement[], offset: number): PageElement[] {
  return els.map((e) => {
    const c = structuredClone(e) as PageElement;
    c.id = uid(e.type[0]);
    c.x += offset;
    c.y += offset;
    if (c.type === "image") {
      c.managed = false;
      c.logo = undefined;
    }
    if (c.type === "text") delete c.labelFor;
    return c;
  });
}

export function duplicateSelection() {
  const els = selectedElements();
  if (!els.length) return;
  const copies = cloneForPaste(els, 10);
  const { pageId } = st();
  st().update((d) => withPage(d, pageId!, (page) => void page.elements.push(...copies)));
  st().select(copies.map((c) => c.id));
}

export function copySelection() {
  const els = selectedElements();
  if (els.length) st().setClipboard(structuredClone(els));
}

export function paste() {
  const { clipboard, pageId } = st();
  if (!clipboard.length || !pageId) return;
  const copies = cloneForPaste(clipboard, 10);
  st().update((d) => withPage(d, pageId, (page) => void page.elements.push(...copies)));
  st().select(copies.map((c) => c.id));
}

export function nudge(dx: number, dy: number) {
  const ids = selectedElements()
    .filter((e) => !e.locked)
    .map((e) => e.id);
  patchElements(ids, (el) => ({ x: el.x + dx, y: el.y + dy }), "nudge");
}

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

export function align(kind: AlignKind) {
  const { doc } = st();
  const els = selectedElements().filter((e) => !e.locked);
  if (!doc || !els.length) return;
  const { W, H } = pageSize(doc.settings);
  const m = doc.settings.margin;
  const ref: Rect = els.length > 1 ? bbox(els) : { x: m.left, y: m.top, w: W - m.left - m.right, h: H - m.top - m.bottom };
  patchElements(
    els.map((e) => e.id),
    (el) => {
      switch (kind) {
        case "left":
          return { x: ref.x };
        case "hcenter":
          return { x: ref.x + (ref.w - el.w) / 2 };
        case "right":
          return { x: ref.x + ref.w - el.w };
        case "top":
          return { y: ref.y };
        case "vcenter":
          return { y: ref.y + (ref.h - el.h) / 2 };
        case "bottom":
          return { y: ref.y + ref.h - el.h };
      }
    },
  );
}

export function distribute(axis: "h" | "v") {
  const els = selectedElements().filter((e) => !e.locked);
  if (els.length < 3) return;
  const sorted = [...els].sort((a, b) => (axis === "h" ? a.x - b.x : a.y - b.y));
  const box = bbox(sorted);
  const total = sorted.reduce((acc, e) => acc + (axis === "h" ? e.w : e.h), 0);
  const gap = ((axis === "h" ? box.w : box.h) - total) / (sorted.length - 1);
  const pos = new Map<string, number>();
  let cur = axis === "h" ? box.x : box.y;
  for (const e of sorted) {
    pos.set(e.id, cur);
    cur += (axis === "h" ? e.w : e.h) + gap;
  }
  patchElements(
    sorted.map((e) => e.id),
    (el) => (axis === "h" ? { x: pos.get(el.id)! } : { y: pos.get(el.id)! }),
  );
}

export function reorder(kind: "front" | "back" | "forward" | "backward") {
  const { pageId, selection } = st();
  if (!pageId || !selection.length) return;
  st().update((d) =>
    withPage(d, pageId, (page) => {
      const sel = page.elements.filter((e) => selection.includes(e.id));
      const rest = page.elements.filter((e) => !selection.includes(e.id));
      if (kind === "front") page.elements = [...rest, ...sel];
      else if (kind === "back") page.elements = [...sel, ...rest];
      else {
        const els = [...page.elements];
        const idxs = els.map((e, i) => (selection.includes(e.id) ? i : -1)).filter((i) => i >= 0);
        const order = kind === "forward" ? [...idxs].reverse() : idxs;
        for (const i of order) {
          const j = kind === "forward" ? i + 1 : i - 1;
          if (j < 0 || j >= els.length || selection.includes(els[j].id)) continue;
          [els[i], els[j]] = [els[j], els[i]];
        }
        page.elements = els;
      }
    }),
  );
}

// ─── layout ─────────────────────────────────────────────────

export function relayout(pageId: string, patch?: Partial<PageLayout>, key?: string) {
  updatePage(
    pageId,
    (page) => {
      if (patch) page.layout = { ...page.layout, ...patch };
      return relayoutPage(page);
    },
    key,
  );
}

export function setArea(pageId: string, area: Partial<Rect>) {
  updatePage(pageId, (page) => relayoutPage({ ...page, area: { ...page.area, ...area } }), "area");
}

/** 자동 레이아웃 이미지 두 장의 순서를 바꾸고 다시 배치 */
export function swapManaged(pageId: string, a: string, b: string) {
  updatePage(pageId, (page) => {
    const ia = page.elements.findIndex((e) => e.id === a);
    const ib = page.elements.findIndex((e) => e.id === b);
    if (ia < 0 || ib < 0) return;
    [page.elements[ia], page.elements[ib]] = [page.elements[ib], page.elements[ia]];
    return relayoutPage(page);
  });
}

/** 자동 레이아웃 순서에서 앞/뒤로 이동 */
export function shiftManaged(pageId: string, id: string, dir: -1 | 1) {
  const page = getPage(st().doc, pageId);
  if (!page) return;
  const managed = page.elements.filter((e) => e.type === "image" && e.managed && !e.logo);
  const i = managed.findIndex((e) => e.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= managed.length) return;
  swapManaged(pageId, id, managed[j].id);
}

export function includeInLayout(ids: string[]) {
  const { pageId } = st();
  if (!pageId) return;
  updatePage(pageId, (page) => {
    for (const el of page.elements) if (ids.includes(el.id) && el.type === "image") el.managed = true;
    return relayoutPage(page);
  });
}

export function addRefsToPage(refs: Reference[], managed: boolean) {
  const { doc, pageId } = st();
  const page = getPage(doc, pageId);
  if (!doc || !page) return;
  const { W, H } = pageSize(doc.settings);
  // 자동 레이아웃에 넣을 때는 회색 박스(빈 자리)부터 채운다
  const slots = managed ? page.elements.filter((e) => e.type === "image" && e.managed && !e.logo && !e.src).map((e) => e.id) : [];
  const filled = refs.slice(0, slots.length);
  const rest = refs.slice(slots.length);
  if (filled.length) {
    updatePage(page.id, (p) => {
      filled.forEach((r, i) => {
        const el = p.elements.find((e): e is ImageElement => e.id === slots[i] && e.type === "image");
        if (el) {
          Object.assign(el, { src: r.imageUrl, refId: r.id, natW: r.width, natH: r.height, sourceUrl: r.sourceUrl, caption: r.title || el.caption });
          if (r.kind === "logo") el.fit = "contain";
        }
      });
      return rest.length ? p : relayoutPage(p);
    });
    if (!rest.length) {
      st().select(slots.slice(0, filled.length));
      return;
    }
  }
  const els = rest.map((r, i) => {
    const el = imageFromRef(r, managed);
    el.logo = undefined;
    if (!managed) {
      const ratio = r.width && r.height ? r.width / r.height : 4 / 3;
      const w = Math.min(W * 0.3, H * 0.4 * ratio);
      Object.assign(el, { x: W / 2 - w / 2 + i * 12, y: H / 2 - w / ratio / 2 + i * 12, w, h: w / ratio });
    }
    return el;
  });
  updatePage(page.id, (p) => {
    p.elements.push(...els);
    return managed ? relayoutPage(p) : p;
  });
  st().select(els.map((e) => e.id));
}

export function replaceImage(elId: string, ref: Reference) {
  const { pageId } = st();
  if (!pageId) return;
  updatePage(pageId, (page) => {
    const el = page.elements.find((e): e is ImageElement => e.id === elId && e.type === "image");
    if (!el) return;
    Object.assign(el, { src: ref.imageUrl, refId: ref.id, natW: ref.width, natH: ref.height, sourceUrl: ref.sourceUrl });
    if (ref.kind === "logo") el.fit = "contain";
    if (isDummyText(el.caption) && ref.title) el.caption = ref.title;
    return el.managed || el.logo ? relayoutPage(page) : page;
  });
}

export function setCaptionsVisible(pageId: string, pos: CaptionPos) {
  updatePage(pageId, (page) => {
    for (const el of page.elements) if (el.type === "image" && !el.logo) el.captionPos = pos;
  });
}

// ─── pages ──────────────────────────────────────────────────

export type NewPageKind = PageKind;

export function addPage(kind: NewPageKind, afterIndex?: number) {
  const { doc, pageId } = st();
  if (!doc) return;
  const s = doc.settings;
  const sections = doc.pages.filter((p) => p.kind === "section").length;
  const page =
    kind === "reference"
      ? createReferencePage(s, { title: "", images: [], placeholders: 5 })
      : kind === "case"
        ? createCasePage(s, { title: "", images: [], logos: [], placeholders: { images: 4, logos: 2 } })
        : kind === "section"
          ? createSectionPage(s, { title: "", number: String(sections + 1).padStart(2, "0") })
          : kind === "cover"
            ? createCoverPage(s)
            : kind === "toc"
              ? createTocPage(s, { entries: tocEntries(doc.pages, s) })
              : kind === "compare"
                ? createComparePage(s)
                : kind === "closing"
                  ? createClosingPage(s)
                  : createBlankPage(s);
  const idx = afterIndex ?? doc.pages.findIndex((p) => p.id === pageId);
  st().update((d) => void d.pages.splice(idx + 1, 0, page));
  st().setPage(page.id);
}

export function duplicatePage(id: string) {
  const { doc } = st();
  const idx = doc?.pages.findIndex((p) => p.id === id) ?? -1;
  if (!doc || idx < 0) return;
  const copy = structuredClone(doc.pages[idx]);
  copy.id = uid("p");
  const idMap = new Map<string, string>();
  for (const el of copy.elements) {
    const nid = uid(el.type[0]);
    idMap.set(el.id, nid);
    el.id = nid;
  }
  for (const el of copy.elements) if (el.type === "text" && el.labelFor) el.labelFor = idMap.get(el.labelFor);
  st().update((d) => void d.pages.splice(idx + 1, 0, copy));
  st().setPage(copy.id);
}

export function deletePage(id: string) {
  const { doc } = st();
  if (!doc || doc.pages.length <= 1) return;
  st().update((d) => {
    d.pages = d.pages.filter((p) => p.id !== id);
  });
}

export function movePage(id: string, toIndex: number) {
  st().update((d) => {
    const from = d.pages.findIndex((p) => p.id === id);
    if (from < 0) return;
    const [p] = d.pages.splice(from, 1);
    d.pages.splice(Math.max(0, Math.min(toIndex, d.pages.length)), 0, p);
  });
}

/** 페이지 크기 변경 — 모든 페이지 요소를 비례 변환 */
export function changePageSize(next: DocumentData["settings"]["pageSize"]) {
  const { doc } = st();
  if (!doc || doc.settings.pageSize === next) return;
  const a = pageSize(doc.settings);
  const b = pageSize({ ...doc.settings, pageSize: next });
  st().update((d) => {
    d.settings.pageSize = next;
    d.pages = d.pages.map((p) => scalePage(p, b.W / a.W, b.H / a.H, d.settings));
    // 템플릿 장식·자리는 새 쪽 크기로 다시 그린다 (내용은 그대로)
    if (themeOf(d.settings).id !== "default") d.pages = d.pages.map((p) => redrawPage(p, d.settings));
  });
}

// ─── 템플릿 ─────────────────────────────────────────────────

/** 문서 템플릿 바꾸기 — 모든 페이지의 내용은 그대로, 장식·자리·색·폰트만 바뀐다 (Ctrl+Z 로 되돌리기) */
export function applyDocTemplate(id: TemplateId, accent?: string) {
  const { doc } = st();
  if (!doc) return;
  const next = applyTemplateToDoc(doc, id, accent);
  st().update((d) => {
    d.settings = next.settings;
    d.pages = next.pages;
  });
}

/** 문서 설정을 통째로 바꾸기 (팀 기본 양식 적용) — 템플릿이 다르면 페이지도 새 템플릿으로 다시 그린다 */
export function replaceDocSettings(next: DocumentData["settings"]) {
  const { doc } = st();
  if (!doc) return;
  const from = doc.settings;
  st().update((d) => {
    d.settings = structuredClone(next);
    if ((from.template ?? "default") !== (next.template ?? "default")) d.pages = d.pages.map((p) => rebuildPage(p, from, d.settings));
  });
}

/** 톤온톤 등 메인 컬러 바꾸기 — 색 토큰을 쓰므로 페이지는 다시 그릴 필요 없다 */
export function setDocMainColor(accent: string) {
  st().update((d) => {
    d.settings = setThemeAccent(d.settings, accent);
  }, { key: "main-color" });
}

export function setCompareItems(pageId: string, items: number) {
  const { doc } = st();
  if (!doc) return;
  updatePage(pageId, (p) => setCompareItemsOf(p, doc.settings, items));
}

export function refreshToc(pageId: string) {
  const { doc } = st();
  if (!doc) return;
  updatePage(pageId, (p) => refreshTocPage(p, doc));
}

// ─── AI ─────────────────────────────────────────────────────

function absoluteUrl(src: string): string {
  try {
    return new URL(src, location.href).href;
  } catch {
    return src;
  }
}

/** 분석·캡션 대상 이미지 — 로고와 빈 회색 박스는 제외 */
export function contentImages(page: Page): ImageElement[] {
  return page.elements.filter((e): e is ImageElement => e.type === "image" && !e.logo && !!e.src);
}

export function analyzeRequestFor(page: Page, doc: DocumentData, instruction?: string, fields?: AiField[]): AnalyzeRequest {
  const lib = useLibrary.getState();
  const refMap = new Map(lib.refs.map((r) => [r.id, r]));
  const images = contentImages(page).map((img) => {
    const ref = img.refId ? refMap.get(img.refId) : undefined;
    return { url: absoluteUrl(img.src), title: ref?.title ?? (isDummyText(img.caption) ? undefined : img.caption), note: ref?.note, tags: ref?.tags };
  });
  // Lorem Ipsum 더미 텍스트는 '비어 있음'으로 취급
  const textOf = (role: TextRole) => {
    const text = page.elements.find((e): e is TextElement => e.type === "text" && e.role === role)?.text;
    return isDummyText(text) ? undefined : text;
  };
  const c = page.caseId ? lib.cases.find((x) => x.id === page.caseId) : undefined;
  return {
    // 목차 · 비교 · 마무리는 AI 에게 빈 페이지로 알려 준다 (제목 · 설명만 쓴다)
    kind: page.kind === "toc" || page.kind === "compare" || page.kind === "closing" ? "blank" : page.kind,
    language: doc.settings.aiLanguage,
    perspective: doc.settings.aiPerspective ?? "design",
    tone: doc.settings.aiTone ?? "report",
    fields,
    group: page.group,
    keywords: parseQuery(doc.query ?? "")
      .filter((t) => !t.exclude)
      .map((t) => t.text),
    caseInfo: c ? { name: c.name, subtitle: c.subtitle, highlight: c.highlight, description: c.description } : undefined,
    current: { title: textOf("title"), subtitle: textOf("subtitle"), highlight: textOf("highlight"), description: textOf("body") },
    images,
    instruction,
  };
}

export type AiField = AiTextField;

export const AI_FIELDS: { key: AiField; label: string; role?: TextRole }[] = [
  { key: "title", label: "타이틀", role: "title" },
  { key: "subtitle", label: "서브타이틀", role: "subtitle" },
  { key: "highlight", label: "강조 라인", role: "highlight" },
  { key: "description", label: "설명", role: "body" },
  { key: "sectionLabel", label: "섹션 라벨", role: "section" },
  { key: "captions", label: "이미지 캡션" },
];

export function applyAnalysis(page: Page, result: AnalyzeResult, fields: Set<AiField>, captionPos?: CaptionPos): Page {
  const next = structuredClone(page);
  for (const f of AI_FIELDS) {
    if (!f.role || !fields.has(f.key)) continue;
    const value = result[f.key as Exclude<AiField, "captions">];
    const el = next.elements.find((e): e is TextElement => e.type === "text" && e.role === f.role && !e.labelFor);
    if (el && typeof value === "string" && value.trim()) {
      // 이어지는 페이지 표시 "(2/3)" 는 유지
      const suffix = f.key === "sectionLabel" || f.key === "title" ? (el.text.match(/\s*\(\d+\/\d+\)$/)?.[0] ?? "") : "";
      el.text = value.trim() + suffix;
    }
  }
  if (fields.has("captions")) {
    contentImages(next).forEach((img, i) => {
      const cap = result.captions[i];
      if (cap?.trim()) img.caption = cap.trim();
      if (captionPos) img.captionPos = captionPos;
    });
  }
  // 설명 길이가 바뀌었을 수 있으니 글 배치를 다시 고른다
  return next.flow ? relayoutPage(next) : next;
}
