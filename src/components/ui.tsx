import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { placePopover, type Placement } from "../lib/placement";
import { normalizeTags } from "../lib/search";
import { useToasts } from "../store/toast";
import { Icon, type IconName } from "./icons";

export function Button({
  children,
  icon,
  variant = "default",
  size = "md",
  className,
  ...rest
}: {
  children?: ReactNode;
  icon?: IconName;
  variant?: "default" | "primary" | "ghost" | "danger" | "accent";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${children ? "" : "btn-icon"} ${className ?? ""}`} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : size === "lg" ? 19 : 16} />}
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 720,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: wide ? "min(1200px, 96vw)" : `min(${width}px, 96vw)` }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <Button icon="x" variant="ghost" onClick={onClose} aria-label="닫기" />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, inline }: { label: ReactNode; children: ReactNode; hint?: ReactNode; inline?: boolean }) {
  return (
    <label className={"field" + (inline ? " field-inline" : "")}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string>(value === undefined ? "" : String(round(value)));
  useEffect(() => setDraft(value === undefined ? "" : String(round(value))), [value]);
  const commit = (s: string) => {
    const n = parseFloat(s);
    if (Number.isFinite(n)) onChange(clamp(n, min, max));
    else setDraft(value === undefined ? "" : String(round(value)));
  };
  return (
    <span className="num-input">
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(n, min, max));
        }}
        onBlur={(e) => commit(e.target.value)}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
function clamp(n: number, min?: number, max?: number) {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/** 문서 템플릿 팔레트 — 색 토큰(ink, tone4 …)을 색 상자에 실제 색으로 보여 주는 데 쓴다 */
export const ColorTokens = createContext<Record<string, string> | null>(null);

export function ColorInput({ value, onChange, allowAccent, allowEmpty }: { value?: string; onChange: (v: string | undefined) => void; allowAccent?: boolean; allowEmpty?: boolean }) {
  const isAccent = value === "accent";
  const tokens = useContext(ColorTokens);
  const shown = value && tokens?.[value] ? tokens[value] : value;
  return (
    <span className="color-input">
      <input type="color" value={!shown ? "#ffffff" : isAccent && !tokens ? "#000000" : toHex(shown)} onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        value={value ?? ""}
        placeholder={allowEmpty ? "없음" : ""}
        onChange={(e) => onChange(e.target.value.trim() || undefined)}
        spellCheck={false}
      />
      {allowAccent && (
        <button type="button" className={"chip-btn" + (isAccent ? " on" : "")} onClick={() => onChange("accent")} title="문서 강조색 사용">
          강조색
        </button>
      )}
      {allowEmpty && value && (
        <button type="button" className="chip-btn" onClick={() => onChange(undefined)}>
          없음
        </button>
      )}
    </span>
  );
}

function toHex(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + [...c.slice(1)].map((x) => x + x).join("");
  return "#000000";
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value);
        if (opt) onChange(opt.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)} title={o.title}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** 태그 입력 — Enter/쉼표로 추가, Backspace 로 삭제, 자동완성 */
export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder = "태그 입력 후 Enter",
  autoFocus,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const add = (raw: string) => {
    const next = normalizeTags([...value, ...normalizeTags(raw)]);
    if (next.length !== value.length) onChange(next);
    setDraft("");
  };
  const q = draft.trim().toLowerCase();
  const matches = q ? suggestions.filter((s) => s.toLowerCase().includes(q) && !value.includes(s)).slice(0, 8) : [];
  return (
    <div className="tag-input">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`${t} 삭제`}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        autoFocus={autoFocus}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,，]$/.test(v)) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (draft.trim()) add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {matches.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/**
 * 버튼 옆에 뜨는 메뉴.
 * 스크롤 영역(overflow) 안에 있어도 잘리지 않게 문서 맨 위 레이어(body)에 그리고,
 * 화면 가장자리에 가까우면 위 · 반대쪽으로 뒤집는다. 높이가 모자라면 메뉴 안에서 스크롤.
 */
export function Menu({ trigger, children, align = "left" }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Placement | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  // 열릴 때(그리기 전에) 크기를 재서 자리를 잡고, 스크롤 · 창 크기 · 내용이 바뀌면 다시 잡는다
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const update = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const m = menuRef.current;
      if (!a || !m) return;
      // 줄였던 높이를 풀고 원래 크기로 잰다
      const prev = m.style.maxHeight;
      m.style.maxHeight = "none";
      const size = { width: m.offsetWidth, height: m.offsetHeight };
      m.style.maxHeight = prev;
      const next = placePopover(a, size, { width: window.innerWidth, height: window.innerHeight }, align);
      setPlace((cur) => (cur && cur.left === next.left && cur.top === next.top && cur.maxHeight === next.maxHeight && cur.up === next.up ? cur : next));
    };
    update();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (menuRef.current) ro?.observe(menuRef.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, align]);

  // 바깥을 누르거나 Esc → 닫기 (Esc 는 메뉴만 닫고 편집기 · 창의 Esc 동작으로 번지지 않게)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchorRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const style: CSSProperties = place
    ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
    : { left: 0, top: 0, visibility: "hidden" }; // 첫 측정용 — 그리기 전에 자리가 잡힌다
  return (
    <div className={"menu-wrap" + (open ? " open" : "")} ref={anchorRef}>
      {trigger(() => setOpen((o) => !o))}
      {open &&
        createPortal(
          <div ref={menuRef} role="menu" className={"menu" + (place?.up ? " menu-up" : "") + (place?.maxHeight !== undefined ? " menu-scroll" : "")} style={style}>
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, hint, disabled }: { icon?: IconName; children: ReactNode; onClick: () => void; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className="menu-item" onClick={onClick} disabled={disabled}>
      {icon ? <Icon name={icon} size={15} /> : <span style={{ width: 15 }} />}
      <span className="menu-label">{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Empty({ title, children, emoji }: { title: ReactNode; children?: ReactNode; emoji?: string }) {
  return (
    <div className="empty">
      {emoji && <span className="empty-emoji">{emoji}</span>}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
