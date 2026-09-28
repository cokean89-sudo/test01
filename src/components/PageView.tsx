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
import { fontStack } from "../lib/fonts";
import { SmartImage } from "./SmartImage";

export const PAGE_CSS = `
.rb-page{position:relative;container-type:inline-size;overflow:hidden;width:100%;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.rb-page *{box-sizing:border-box}
.rb-el{position:absolute}
.rb-text{white-space:pre-wrap;word-break:keep-all;overflow-wrap:break-word}
.rb-editable{outline:none;cursor:text;min-height:1em}
.rb-placeholder{color:#9aa0a6!important;font-style:italic}
.img-missing{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:repeating-linear-gradient(45deg,#f1f1f1,#f1f1f1 6px,#e7e7e7 6px,#e7e7e7 12px);color:#888;font:11px/1.3 sans-serif;text-align:center;padding:4px}
.img-missing small{opacity:.7;font-size:10px}
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

export function resolveColor(c: string | undefined, settings: DocSettings): string | undefined {
  if (!c) return undefined;
  return c === "accent" ? settings.accent : c;
}

const ROLE_PLACEHOLDER: Record<TextRole, string> = {
  title: "타이틀",
  subtitle: "서브타이틀",
  highlight: "강조 라인 (예: 스폰서 / 소유)",
  body: "설명을 입력하거나 AI 분석을 실행하세요",
  section: "섹션 라벨",
  label: "라벨",
  caption: "캡션",
  footer: "태그라인",
  free: "텍스트",
};

interface Props {
  page: Page;
  settings: DocSettings;
  index: number;
  total: number;
  mode?: PageMode;
  editingId?: string | null;
  onTextCommit?: (id: string, text: string) => void;
  onImageNatural?: (id: string, w: number, h: number) => void;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function PageView({ page, settings, index, total, mode = "view", editingId, onTextCommit, onImageNatural, className, style, children }: Props) {
  const { W, H } = pageSize(settings);
  const u = (pt: number) => `${(pt / W) * 100}cqw`;
  return (
    <div
      className={"rb-page " + (className ?? "")}
      style={{ aspectRatio: `${W} / ${H}`, background: page.background ?? settings.background, ...style }}
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
          onImageNatural={onImageNatural}
        />
      ))}
      <Chrome page={page} settings={settings} index={index} total={total} W={W} H={H} u={u} />
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
  onImageNatural?: (id: string, w: number, h: number) => void;
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
}: {
  el: TextElement;
  settings: DocSettings;
  W: number;
  H: number;
  u: U;
  mode: PageMode;
  editing: boolean;
  onTextCommit?: (id: string, text: string) => void;
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

  let content: ReactNode = el.text;
  if (editing) {
    content = <EditableText text={el.text} onCommit={(t) => onTextCommit?.(el.id, t)} />;
  } else if (empty) {
    content = <span className="rb-placeholder">{ROLE_PLACEHOLDER[el.role]}</span>;
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
        {el.text}
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

function EditableText({ text, onCommit }: { text: string; onCommit: (text: string) => void }) {
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

/** 문서 양식: 헤더 / 하단 태그라인 / 페이지 번호 */
function Chrome({ page, settings, index, total, W, H, u }: { page: Page; settings: DocSettings; index: number; total: number; W: number; H: number; u: U }) {
  if (page.hideFooter) return null;
  const m = settings.margin;
  const { footer, header } = settings;
  const st = resolveStyle(settings, "footer");
  const css: CSSProperties = { ...textCss(st, u), position: "absolute", whiteSpace: "nowrap" };
  const num = footer.pageNumber ? formatPageNumber(footer.pageNumberFormat, index + settings.pageNumberStart, total + settings.pageNumberStart - 1) : "";
  const slot = (pos: "left" | "center" | "right", text: string) => {
    const withNum = footer.pageNumber && footer.pageNumberPos === pos ? [text, num].filter(Boolean) : [text].filter(Boolean);
    if (!withNum.length) return null;
    return (
      <span style={{ display: "inline-flex", gap: u(st.fontSize * 3) }}>
        {withNum.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </span>
    );
  };
  const fy = H - m.bottom * 0.62;
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
