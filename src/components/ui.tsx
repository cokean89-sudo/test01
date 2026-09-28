import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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

export function ColorInput({ value, onChange, allowAccent, allowEmpty }: { value?: string; onChange: (v: string | undefined) => void; allowAccent?: boolean; allowEmpty?: boolean }) {
  const isAccent = value === "accent";
  return (
    <span className="color-input">
      <input type="color" value={!value ? "#ffffff" : isAccent ? "#000000" : toHex(value)} onChange={(e) => onChange(e.target.value)} />
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

export function Menu({ trigger, children, align = "left" }: { trigger: (open: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className={"menu menu-" + align}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, hint, disabled }: { icon?: IconName; children: ReactNode; onClick: () => void; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" className="menu-item" onClick={onClick} disabled={disabled}>
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
