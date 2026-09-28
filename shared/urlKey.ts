// 중복 이미지 판별용 URL 정규화 키.
// - 핀터레스트 이미지: 크기 경로(236x/736x/originals)와 무관하게 이미지 해시로 비교
// - 일반 URL: 프로토콜·www·추적용 파라미터(utm_*, fbclid 등)·#해시 무시, 나머지 파라미터 정렬

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|igshid|mc_cid|mc_eid|ref|ref_src|_ga|si)$/i;

export function urlKey(raw: string): string {
  const s = raw.trim();
  const pin = s.match(/i\.pinimg\.com\/[^/]+\/((?:[0-9a-f]{2}\/){3}[0-9a-f]+)\.\w+/i);
  if (pin) return "pinimg:" + pin[1].toLowerCase();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return "raw:" + s.toLowerCase();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "raw:" + s.toLowerCase();
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
  const port = u.port && u.port !== "80" && u.port !== "443" ? ":" + u.port : "";
  return `url:${host}${port}${u.pathname.replace(/\/+$/, "") || "/"}${query}`;
}
