// PowerPoint 내보내기 — 텍스트는 편집 가능한 텍스트 상자, 이미지는 크롭·초점을 반영해 삽입.

import PptxGenJS from "pptxgenjs";
import type { DocSettings, DocumentData, ImageElement, Page } from "../../shared/types";
import { proxied } from "../api";
import { fillTitle, fillTokens, pageSize, resolveColor, resolveStyle } from "../components/PageView";
import { formatPageNumber } from "../lib/defaults";

const inch = (pt: number) => pt / 72;

function hex(c: string | undefined, fallback = "111111"): string {
  if (!c) return fallback;
  const m3 = c.match(/^#([0-9a-f]{3})$/i);
  if (m3) return [...m3[1]].map((x) => x + x).join("");
  const m6 = c.match(/^#([0-9a-f]{6})/i);
  return m6 ? m6[1] : fallback;
}

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const res = await fetch(/^https?:\/\//i.test(src) ? proxied(src) : src);
    if (!res.ok) return null;
    const url = URL.createObjectURL(await res.blob());
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** 요소 상자 비율에 맞춰 cover/contain + 초점 + 모서리를 적용한 이미지 데이터 */
function renderBox(img: HTMLImageElement, el: ImageElement, boxW: number, boxH: number): string {
  const nw = img.naturalWidth || 1200;
  const nh = img.naturalHeight || 900;
  const aspect = boxW / boxH;
  let sx = 0;
  let sy = 0;
  let sw = nw;
  let sh = nh;
  if (el.fit === "cover") {
    if (nw / nh > aspect) {
      sw = nh * aspect;
      sx = ((nw - sw) * (el.focusX ?? 50)) / 100;
    } else {
      sh = nw / aspect;
      sy = ((nh - sh) * (el.focusY ?? 50)) / 100;
    }
  }
  const cw = Math.round(Math.max(200, Math.min(2400, el.fit === "cover" ? sw : nw, boxW * 4)));
  const ch = Math.round(cw / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  const k = cw / boxW;
  if (el.radius) {
    ctx.beginPath();
    ctx.roundRect(0, 0, cw, ch, el.radius * k);
    ctx.clip();
  }
  if (el.fit === "cover") {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
  } else {
    const s = Math.min(cw / nw, ch / nh);
    ctx.drawImage(img, (cw - nw * s) / 2, (ch - nh * s) / 2, nw * s, nh * s);
  }
  const opaque = el.fit === "cover" && !el.radius;
  return canvas.toDataURL(opaque ? "image/jpeg" : "image/png", 0.9);
}

const WEIGHT_NAMES: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 500: "Medium", 600: "SemiBold", 800: "ExtraBold", 900: "Black" };

/**
 * PowerPoint 는 굵기를 '굵게' 하나로만 표현하므로, 정적 폰트 이름(예: "Poppins SemiBold")으로 굵기를 살린다.
 * 400·700 은 기본 이름 + 굵게 여부로 처리.
 */
export function pptxFont(family: string, weight: number): { fontFace: string; bold: boolean } {
  const w = Math.round(weight / 100) * 100;
  if (w === 400 || w === 700) return { fontFace: family, bold: w === 700 };
  const name = WEIGHT_NAMES[w];
  return name ? { fontFace: `${family} ${name}`, bold: false } : { fontFace: family, bold: w >= 600 };
}

function addChrome(slide: PptxGenJS.Slide, page: Page, settings: DocSettings, index: number, total: number, title: string) {
  if (page.hideFooter) return;
  const { W, H } = pageSize(settings);
  const m = settings.margin;
  const st = resolveStyle(settings, "footer");
  const base = {
    ...pptxFont(st.fontFamily, st.fontWeight),
    fontSize: st.fontSize,
    color: hex(st.color),
    charSpacing: (st.tracking / 1000) * st.fontSize,
    margin: 0,
    valign: "top" as const,
  };
  const up = (t: string) => {
    const s = fillTitle(t, title);
    return st.uppercase ? s.toUpperCase() : s;
  };
  const f = settings.footer;
  if (f.show) {
    const num = f.pageNumber ? formatPageNumber(f.pageNumberFormat, index + settings.pageNumberStart, total + settings.pageNumberStart - 1) : "";
    // 페이지 번호는 두 단계 굵게 (템플릿: Light 문구 + Medium 번호)
    const numFont = pptxFont(st.fontFamily, Math.min(900, st.fontWeight + 200));
    const runs = (pos: "left" | "center" | "right", t: string): PptxGenJS.TextProps[] => {
      const out: PptxGenJS.TextProps[] = [];
      if (t) out.push({ text: up(t) });
      if (f.pageNumber && f.pageNumberPos === pos && num) {
        if (out.length) out.push({ text: "     " });
        out.push({ text: up(num), options: numFont });
      }
      return out.length ? out : [{ text: "" }];
    };
    const y = inch(H - 20);
    const w = inch((W - m.left - m.right) / 3);
    const h = inch(st.fontSize * 1.6);
    slide.addText(runs("left", f.left), { ...base, x: inch(m.left), y, w, h, align: "left" });
    slide.addText(runs("center", f.center), { ...base, x: inch(m.left) + w, y, w, h, align: "center" });
    slide.addText(runs("right", f.right), { ...base, x: inch(m.left) + w * 2, y, w, h, align: "right" });
    if (f.divider) {
      slide.addShape("line", { x: inch(m.left), y: y - inch(4), w: inch(W - m.left - m.right), h: 0, line: { color: hex(st.color), width: 0.5, transparency: 60 } });
    }
  }
  const hd = settings.header;
  if (hd.show) {
    const y = inch(m.top * 0.32);
    const w = inch((W - m.left - m.right) / 2);
    const h = inch(st.fontSize * 1.6);
    slide.addText(up(hd.left), { ...base, x: inch(m.left), y, w, h, align: "left" });
    slide.addText(up(hd.right), { ...base, x: inch(m.left) + w, y, w, h, align: "right" });
  }
}

export async function exportPptx(doc: DocumentData): Promise<void> {
  const { settings } = doc;
  const { W, H } = pageSize(settings);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "REFBOARD", width: inch(W), height: inch(H) });
  pptx.layout = "REFBOARD";
  pptx.title = doc.title;

  const cache = new Map<string, Promise<HTMLImageElement | null>>();
  const getImage = (src: string) => {
    if (!cache.has(src)) cache.set(src, loadImage(src));
    return cache.get(src)!;
  };
  // 미리 병렬로 받아 둔다
  for (const p of doc.pages) for (const el of p.elements) if (el.type === "image" && el.src) void getImage(el.src);

  for (const [i, page] of doc.pages.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: hex(resolveColor(page.background ?? settings.background, settings), "FFFFFF") };
    for (const el of page.elements) {
      const box = { x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h), rotate: el.rotation || undefined };
      const transparency = el.opacity !== undefined && el.opacity < 1 ? Math.round((1 - el.opacity) * 100) : undefined;
      if (el.type === "text") {
        if (!el.text.trim()) continue;
        const st = resolveStyle(settings, el.role, el.style);
        const text = fillTokens(el.text, settings, doc.title);
        slide.addText(st.uppercase ? text.toUpperCase() : text, {
          ...box,
          ...pptxFont(st.fontFamily, st.fontWeight),
          fontSize: st.fontSize,
          italic: st.italic,
          color: hex(st.color),
          transparency,
          align: st.align,
          valign: st.vAlign,
          charSpacing: (st.tracking / 1000) * st.fontSize,
          // 줄 간격은 pt 로 고정 — 화면(CSS line-height)과 같은 줄 높이라서 목차·비교 표의 행이 어긋나지 않는다
          lineSpacing: Math.round(st.lineHeight * st.fontSize * 10) / 10,
          margin: st.bgMode === "box" && st.background ? st.padding : 0,
          fill: st.background ? { color: hex(st.background) } : undefined,
          fit: "none",
        });
      } else if (el.type === "image") {
        const cs = resolveStyle(settings, "caption", el.captionStyle);
        const showCap = !!el.caption?.trim() && !!el.captionPos && el.captionPos !== "none";
        const capH = showCap ? cs.fontSize * cs.lineHeight * 1.25 + 6 : 0;
        const below = showCap && el.captionPos === "below";
        const imgH = below ? el.h - capH : el.h;
        const img = el.src ? await getImage(el.src) : null;
        if (img) {
          slide.addImage({ data: renderBox(img, el, el.w, imgH), x: box.x, y: box.y, w: box.w, h: inch(imgH), rotate: box.rotate, transparency });
        } else {
          // 빈 자리·불러오지 못한 이미지는 회색 박스로
          slide.addShape("rect", { x: box.x, y: box.y, w: box.w, h: inch(imgH), fill: { color: "D9D9D9" }, line: { type: "none" } });
        }
        if (showCap) {
          const capColor = below && !el.captionStyle?.color ? "333333" : hex(cs.color, "FFFFFF");
          slide.addText(el.caption!, {
            x: box.x,
            y: below ? inch(el.y + imgH) : el.captionPos === "overlay-top" ? box.y : inch(el.y + el.h - capH),
            w: box.w,
            h: inch(capH),
            fontFace: cs.fontFamily,
            fontSize: cs.fontSize,
            bold: cs.fontWeight >= 600,
            color: capColor,
            charSpacing: (cs.tracking / 1000) * cs.fontSize,
            margin: below ? 0 : 4,
            valign: below ? "top" : "middle",
            fill: below ? undefined : { color: hex(cs.background, "000000"), transparency: cs.background ? 0 : 45 },
          });
        }
      } else {
        const fill = resolveColor(el.fill, settings);
        const stroke = resolveColor(el.stroke, settings);
        if (el.shape === "line") {
          const horizontal = el.w >= el.h;
          slide.addShape("line", {
            x: box.x,
            y: horizontal ? inch(el.y + el.h / 2) : box.y,
            w: horizontal ? box.w : 0,
            h: horizontal ? 0 : box.h,
            line: { color: hex(stroke ?? fill), width: el.strokeWidth || 0.75, transparency },
          });
        } else {
          slide.addShape(el.shape === "ellipse" ? "ellipse" : el.radius ? "roundRect" : "rect", {
            ...box,
            fill: fill ? { color: hex(fill), transparency } : { type: "none" },
            line: stroke && el.strokeWidth ? { color: hex(stroke), width: el.strokeWidth } : { type: "none" },
            rectRadius: el.radius ? Math.min(0.5, el.radius / Math.min(el.w, el.h)) : undefined,
          });
        }
      }
    }
    addChrome(slide, page, settings, i, doc.pages.length, doc.title);
    if (page.notes) slide.addNotes(page.notes);
  }
  await pptx.writeFile({ fileName: `${doc.title || "document"}.pptx` });
}
