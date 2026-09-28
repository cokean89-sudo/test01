import { useEffect, useState, type CSSProperties } from "react";
import { proxied } from "../api";

interface Props {
  src: string;
  fit?: "cover" | "contain";
  position?: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  loading?: "lazy" | "eager";
  onNatural?: (w: number, h: number) => void;
  /** 빈 자리(회색 박스)에 표시할 안내 문구 */
  hint?: string;
}

/** 회색 박스 가운데 들어가는 이미지 아이콘 */
function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 48 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="44" height="36" rx="3" />
      <path d="M2 30l12-12 10 10 7-7 15 15" />
      <circle cx="33" cy="12" r="4" />
    </svg>
  );
}

/**
 * 외부 이미지를 링크 그대로 표시한다. 핫링크가 막히면 서버 프록시로 한 번 더 시도.
 * referrerPolicy=no-referrer 로 대부분의 핫링크 차단을 피한다.
 */
export function SmartImage({ src, fit = "cover", position, alt = "", className, style, loading = "lazy", onNatural, hint }: Props) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => setStage(0), [src]);

  if (!src || stage === 2) {
    let host = "";
    if (src) {
      try {
        host = new URL(src, location.href).hostname;
      } catch {
        /* ignore */
      }
    }
    return (
      <div className={"img-missing " + (className ?? "")} style={style} title={src || undefined}>
        <PlaceholderIcon />
        {src ? <span>이미지를 불러올 수 없음</span> : hint ? <span>{hint}</span> : null}
        {host && <small>{host}</small>}
      </div>
    );
  }

  return (
    <img
      src={stage === 0 ? src : proxied(src)}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      draggable={false}
      decoding="async"
      loading={loading}
      style={{ width: "100%", height: "100%", objectFit: fit, objectPosition: position, display: "block", ...style }}
      onLoad={(e) => onNatural?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
      onError={() => setStage((s) => (s === 0 && /^https?:\/\//i.test(src) ? 1 : 2))}
    />
  );
}
