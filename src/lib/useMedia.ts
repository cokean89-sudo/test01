import { useEffect, useState } from "react";

/** 휴대폰 화면 폭 — styles.css 의 모바일 구간(@media (max-width: 720px))과 같은 기준 */
export const MOBILE_QUERY = "(max-width: 720px)";

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export const useIsMobile = () => useMedia(MOBILE_QUERY);
