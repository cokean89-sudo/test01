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
}

/**
 * 외부 이미지를 링크 그대로 표시한다. 핫링크가 막히면 서버 프록시로 한 번 더 시도.
 * referrerPolicy=no-referrer 로 대부분의 핫링크 차단을 피한다.
 */
export function SmartImage({ src, fit = "cover", position, alt = "", className, style, loading = "lazy", onNatural }: Props) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => setStage(0), [src]);

  if (!src || stage === 2) {
    let host = "";
    try {
      host = new URL(src, location.href).hostname;
    } catch {
      /* ignore */
    }
    return (
      <div className={"img-missing " + (className ?? "")} style={style} title={src}>
        <span>{src ? "이미지를 불러올 수 없음" : "이미지 없음"}</span>
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
