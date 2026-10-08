// 페이지 렌더러 — 편집기·썸네일·웹 뷰어·인쇄·HTML 내보내기가 모두 같은 컴포넌트를 쓴다.
// 좌표는 % 로, 글자 크기 등은 cqw(컨테이너 폭 기준) 로 표현해 어떤 크기로 그려도 비율이 같다.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import {
  PAGE_SIZES,
  type DocSettings,
  type ImageElement,
  type Page,
  type PageElement,
  type ShapeElement,
  type TextElement,
  type TextRole,
  type TextStyle,
} from "../../shared/types";
import { formatPageNumber, REPORT_TYPOGRAPHY } from "../lib/defaults";
import { dummyText } from "../lib/dummy";
import { fontStack } from "../lib/fonts";
import { resolveToken } from "../layout/themes";
import { SmartImage } from "./SmartImage";

export const PAGE_CSS = `
.rb-page{position:relative;container-type:inline-size;overflow:hidden;width:100%;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rb-page *{box-sizing:border-box}
.rb-el{position:absolute}
.rb-text{white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word}
.rb-editable{outline:none;cursor:text;min-height:1em}
.rb-placeholder{color:#9aa0a6!important;font-style:italic}
.img-missing{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:#d9d9d9;color:#9a9a9a;font:11px/1.3 sans-serif;text-align:center;padding:4px;overflow:hidden}
.img-missing svg{width:min(22%,48px);height:auto;flex:none}
.img-missing span{font-size:10px;color:#8a8a8a}
.img-missing small{opacity:.7;font-size:9px}
`;

export type PageMode = "view" | "edit" | "thumb" | "print";

export function pageSize(settings: DocSettings) {
  const s = PAGE_SIZES[settings.pageSize];
  return { W: s.w, H: s.h };
}

export function resolveStyle(settings: DocSettings, role: TextRole, override?: TextStyle): Required<Omit<TextStyle, "background">> & { background?: string } {
  const merged: TextStyle = { ...REPORT_TYPOGRAPHY.free, ...REPORT_TYPOGRAPHY[role], ...settings.typography[role], ...override };
  return {
    fontFamily: merged.fontFamily ?? "Pretendard",
    fontSize: merged.fontSize ?? 9,
    fontWeight: merged.fontWeight ?? 400,
    italic: merged.italic ?? false,
    tracking: merged.tracking ?? 0,
    lineHeight: merged.lineHeight ?? 1.4,
    color: resolveColor(merged.color, settings) ?? "#111111",
    align: merged.align ?? "left",
    vAlign: merged.vAlign ?? "top",
    background: resolveColor(merged.background, settings),
    bgMode: merged.bgMode ?? "box",
    padding: merged.padding ?? 0,
    uppercase: merged.uppercase ?? false,
  };
}

/** 색 토큰(accent, ink, paper, tone1~6 …)을 문서 템플릿 팔레트로 바꾼다 */
export function resolveColor(c: string | undefined, settings: DocSettings): string | undefined {
  return resolveToken(c, settings);
}

interface Props {
  page: Page;
  settings: DocSettings;
  index: number;
  total: number;
  mode?: PageMode;
  editingId?: string | null;
  onTextCommit?: (id: string, text: string) => void;
  /** 입력하는 동안 (공동 편집 — 끝내기 전에도 다른 사람에게 보이게) */
  onTextLive?: (id: string, text: string) => void;
  onImageNatural?: (id: string, w: number, h: number) => void;
  /** 하단/상단 문구의 {title} 자리에 들어갈 문서 제목 */
  docTitle?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PageView({ page, settings, index, total, mode = "view", editingId, onTextCommit, onTextLive, onImageNatural, docTitle, className, style, children }: Props) {
  const { W, H } = pageSize(settings);
  const u = (pt: number) => `${(pt / W) * 100}cqw`;
  return (
    <div
      className={"rb-page " + (className ?? "")}
      style={{ aspectRatio: `${W} / ${H}`, background: resolveColor(page.background ?? settings.background, settings), ...style }}
      data-page-id={page.id}
    >
      {page.elements.map((el) => (
        <ElementView
          key={el.id}
          el={el}
          settings={settings}
          W={W}
          H={H}
          u={u}
          mode={mode}
          editing={editingId === el.id}
          onTextCommit={onTextCommit}
          onTextLive={onTextLive}
          onImageNatural={onImageNatural}
          docTitle={docTitle}
        />
      ))}
      <Chrome page={page} settings={settings} index={index} total={total} W={W} H={H} u={u} docTitle={docTitle} />
      {children}
    </div>
  );
}

type U = (pt: number) => string;

function rectStyle(el: PageElement, W: number, H: number): CSSProperties {
  return {
    left: `${(el.x / W) * 100}%`,
    top: `${(el.y / H) * 100}%`,
    width: `${(el.w / W) * 100}%`,
    height: `${(el.h / H) * 100}%`,
    opacity: el.opacity ?? 1,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
  };
}

function ElementView(props: {
  el: PageElement;
  settings: DocSettings;
  W: number;
  H: number;
  u: U;
  mode: PageMode;
  editing: boolean;
  onTextCommit?: (id: string, text: string) => void;
  /** 입력하는 동안 (공동 편집 — 끝내기 전에도 다른 사람에게 보이게) */
  onTextLive?: (id: string, text: string) => void;
  onImageNatural?: (id: string, w: number, h: number) => void;
  docTitle?: string;
}) {
  const { el } = props;
  if (el.type === "text") return <TextView {...props} el={el} />;
  if (el.type === "image") return <ImageView {...props} el={el} />;
  return <ShapeView el={el} W={props.W} H={props.H} u={props.u} settings={props.settings} />;
}

export function textCss(st: ReturnType<typeof resolveStyle>, u: U): CSSProperties {
  return {
    fontFamily: fontStack(st.fontFamily),
    fontSize: u(st.fontSize),
    fontWeight: st.fontWeight,
    fontStyle: st.italic ? "italic" : "normal",
    letterSpacing: `${st.tracking / 1000}em`,
    lineHeight: st.lineHeight,
    color: st.color,
    textAlign: st.align,
    textTransform: st.uppercase ? "uppercase" : "none",
  };
}

function TextView({
  el,
  settings,
  W,
  H,
  u,
  mode,
  editing,
  onTextCommit,
  onTextLive,
  docTitle,
}: {
  el: TextElement;
  settings: DocSettings;
  W: number;
  H: number;
  u: U;
  mode: PageMode;
  editing: boolean;
  onTextCommit?: (id: string, text: string) => void;
  /** 입력하는 동안 (공동 편집 — 끝내기 전에도 다른 사람에게 보이게) */
  onTextLive?: (id: string, text: string) => void;
  docTitle?: string;
}) {
  const st = resolveStyle(settings, el.role, el.style);
  const box: CSSProperties = {
    ...rectStyle(el, W, H),
    display: "flex",
    flexDirection: "column",
    justifyContent: st.vAlign === "middle" ? "center" : st.vAlign === "bottom" ? "flex-end" : "flex-start",
    padding: st.bgMode === "box" && st.padding ? u(st.padding) : undefined,
    background: st.bgMode === "box" ? st.background : undefined,
  };
  const empty = !el.text.trim();
  if (empty && mode !== "edit" && !editing) return null;

  const shown = fillTokens(el.text, settings, docTitle);
  let content: ReactNode = shown;
  if (editing) {
    content = <EditableText text={el.text} onCommit={(t) => onTextCommit?.(el.id, t)} onLive={onTextLive && ((t) => onTextLive(el.id, t))} />;
  } else if (empty) {
    content = <span className="rb-placeholder">{dummyText(el.role)}</span>;
  } else if (st.bgMode === "inline" && st.background) {
    content = (
      <span
        style={{
          background: st.background,
          padding: `${u(st.padding * 0.4)} ${u(st.padding)}`,
          boxDecorationBreak: "clone",
          WebkitBoxDecorationBreak: "clone",
        }}
      >
        {shown}
      </span>
    );
  }
  return (
    <div className="rb-el" style={box} data-el-id={el.id}>
      <div className="rb-text" style={textCss(st, u)}>
        {content}
      </div>
    </div>
  );
}

function EditableText({ text, onCommit, onLive }: { text: string; onCommit: (text: string) => void; onLive?: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerText = text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(ref.current?.innerText.replace(/\n$/, "") ?? text);
  };
  return (
    <div
      ref={ref}
      className="rb-editable"
      contentEditable
      suppressContentEditableWarning
      onBlur={commit}
      onInput={() => !done.current && onLive?.(ref.current?.innerText.replace(/\n$/, "") ?? "")}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
      onPaste={(e) => {
        // 서식 없이 붙여넣기
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}

function ImageView({
  el,
  settings,
  W,
  H,
  u,
  mode,
  onImageNatural,
}: {
  el: ImageElement;
  settings: DocSettings;
  W: number;
  H: number;
  u: U;
  mode: PageMode;
  onImageNatural?: (id: string, w: number, h: number) => void;
}) {
  const showCaption = !!el.caption?.trim() && !!el.captionPos && el.captionPos !== "none";
  const cs = resolveStyle(settings, "caption", el.captionStyle);
  const below = showCaption && el.captionPos === "below";
  const capColor = below && !el.captionStyle?.color ? "#333333" : cs.color;
  const radius = el.radius ? u(el.radius) : undefined;
  const img = (
    <SmartImage
      src={el.src}
      fit={el.fit}
      position={`${el.focusX ?? 50}% ${el.focusY ?? 50}%`}
      loading={mode === "print" ? "eager" : "lazy"}
      hint={mode === "edit" ? "더블클릭해서 이미지 선택" : undefined}
      style={below ? { height: "auto", flex: 1, minHeight: 0, borderRadius: radius } : undefined}
      onNatural={onImageNatural && (!el.natW || !el.natH) ? (w, h) => onImageNatural(el.id, w, h) : undefined}
    />
  );
  return (
    <div
      className="rb-el"
      data-el-id={el.id}
      style={{
        ...rectStyle(el, W, H),
        overflow: "hidden",
        borderRadius: below ? undefined : radius,
        display: below ? "flex" : undefined,
        flexDirection: below ? "column" : undefined,
        gap: below ? u(3) : undefined,
      }}
    >
      {img}
      {showCaption && (
        <div
          className="rb-text"
          style={{
            ...textCss(cs, u),
            color: capColor,
            ...(below
              ? { flex: "none" }
              : {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  [el.captionPos === "overlay-top" ? "top" : "bottom"]: 0,
                  padding: `${u(cs.padding || 5)} ${u((cs.padding || 5) * 1.3)}`,
                  background:
                    cs.background ??
                    (el.captionPos === "overlay-top"
                      ? "linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,0))"
                      : "linear-gradient(rgba(0,0,0,0), rgba(0,0,0,.6))"),
                }),
          }}
        >
          {el.caption}
        </div>
      )}
    </div>
  );
}

function ShapeView({ el, W, H, u, settings }: { el: ShapeElement; W: number; H: number; u: U; settings: DocSettings }) {
  const fill = resolveColor(el.fill, settings);
  const stroke = resolveColor(el.stroke, settings);
  const sw = el.strokeWidth ?? 0;
  if (el.shape === "line") {
    const horizontal = el.w >= el.h;
    return (
      <div className="rb-el" data-el-id={el.id} style={{ ...rectStyle(el, W, H), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            background: stroke ?? fill ?? "#111",
            width: horizontal ? "100%" : u(Math.max(sw, 0.5)),
            height: horizontal ? u(Math.max(sw, 0.5)) : "100%",
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="rb-el"
      data-el-id={el.id}
      style={{
        ...rectStyle(el, W, H),
        background: fill,
        border: sw && stroke ? `${u(sw)} solid ${stroke}` : undefined,
        borderRadius: el.shape === "ellipse" ? "50%" : el.radius ? u(el.radius) : undefined,
      }}
    />
  );
}

/** 문구 안의 {title} 을 문서 제목으로 바꾼다 */
export function fillTitle(text: string, docTitle?: string): string {
  return text.includes("{title}") ? text.replaceAll("{title}", docTitle?.trim() || "Untitled") : text;
}

/** 본문 글의 자리표시 — {title} 문서 제목, {dept} 부서명(하단 왼쪽 문구) */
export function fillTokens(text: string, settings: DocSettings, docTitle?: string): string {
  if (!text.includes("{")) return text;
  const dept = fillTitle(settings.footer.left, docTitle).trim() || "OO TEAM";
  return fillTitle(text, docTitle).replaceAll("{dept}", dept);
}

/** 문서 양식: 헤더 / 하단 태그라인 / 페이지 번호 */

function Chrome({ page, settings, index, total, W, H, u, docTitle }: { page: Page; settings: DocSettings; index: number; total: number; W: number; H: number; u: U; docTitle?: string }) {
  if (page.hideFooter) return null;
  const m = settings.margin;
  const footer = { ...settings.footer, left: fillTitle(settings.footer.left, docTitle), center: fillTitle(settings.footer.center, docTitle), right: fillTitle(settings.footer.right, docTitle) };
  const header = { ...settings.header, left: fillTitle(settings.header.left, docTitle), right: fillTitle(settings.header.right, docTitle) };
  const st = resolveStyle(settings, "footer");
  const css: CSSProperties = { ...textCss(st, u), position: "absolute", whiteSpace: "nowrap" };
  const num = footer.pageNumber ? formatPageNumber(footer.pageNumberFormat, index + settings.pageNumberStart, total + settings.pageNumberStart - 1) : "";
  const slot = (pos: "left" | "center" | "right", text: string) => {
    const withNum = footer.pageNumber && footer.pageNumberPos === pos ? [text, num].filter(Boolean) : [text].filter(Boolean);
    if (!withNum.length) return null;
    return (
      <span style={{ display: "inline-flex", gap: u(st.fontSize * 2.5) }}>
        {withNum.map((t, i) => (
          // 페이지 번호는 두 단계 굵게 (템플릿: Light 문구 + Medium 번호)
          <span key={i} style={t === num && footer.pageNumberPos === pos ? { fontWeight: Math.min(900, st.fontWeight + 200) } : undefined}>
            {t}
          </span>
        ))}
      </span>
    );
  };
  // 템플릿 기준: 하단 태그라인 기준선은 페이지 아래에서 약 15pt (A4 가로 580.4pt)
  const fy = H - 20;
  const hy = m.top * 0.32;
  return (
    <>
      {footer.show && (
        <>
          {footer.divider && (
            <div
              className="rb-el"
              style={{ left: `${(m.left / W) * 100}%`, right: `${(m.right / W) * 100}%`, top: `${((fy - 4) / H) * 100}%`, height: u(0.5), background: st.color, opacity: 0.4 }}
            />
          )}
          <div style={{ ...css, left: `${(m.left / W) * 100}%`, top: `${(fy / H) * 100}%` }}>{slot("left", footer.left)}</div>
          <div style={{ ...css, left: "50%", transform: "translateX(-50%)", top: `${(fy / H) * 100}%` }}>{slot("center", footer.center)}</div>
          <div style={{ ...css, right: `${(m.right / W) * 100}%`, top: `${(fy / H) * 100}%` }}>{slot("right", footer.right)}</div>
        </>
      )}
      {header.show && (
        <>
          <div style={{ ...css, left: `${(m.left / W) * 100}%`, top: `${(hy / H) * 100}%` }}>{header.left}</div>
          <div style={{ ...css, right: `${(m.right / W) * 100}%`, top: `${(hy / H) * 100}%` }}>{header.right}</div>
          {header.divider && (
            <div
              className="rb-el"
              style={{ left: `${(m.left / W) * 100}%`, right: `${(m.right / W) * 100}%`, top: `${((hy + st.fontSize * 1.8) / H) * 100}%`, height: u(0.5), background: st.color, opacity: 0.4 }}
            />
          )}
        </>
      )}
    </>
  );
}
