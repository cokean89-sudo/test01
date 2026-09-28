// 링크에서 이미지 후보를 뽑아낸다 — 핀터레스트 핀/보드, 일반 웹페이지, 이미지 직접 링크.

import type { ScrapeItem, ScrapeResult } from "../shared/types";
import { FetchError, normalizeUrl, readLimited, safeFetch, sniffImageType } from "./net";

const MAX_ITEMS = 80;

// ─── HTML helpers (의존성 없이 정규식 기반) ───────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=<>/"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

function tags(html: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return (html.match(re) ?? []).map(parseAttrs);
}

function absolutize(src: string, base: URL): string | null {
  const s = src.trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:") || s.startsWith("javascript:")) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** srcset 에서 가장 큰 후보를 고른다 */
export function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, desc = "1x"] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = parseFloat(desc) * (desc.endsWith("w") ? 1 : 1000);
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url ?? null;
}

const JUNK = /(favicon|sprite|spacer|blank\.gif|pixel|tracking|analytics|doubleclick|facebook\.com\/tr|\/ads?\/|gravatar|emoji|\.ico(\?|$))/i;

export interface PageMeta {
  title?: string;
  description?: string;
  images: ScrapeItem[];
}

/** 일반 웹페이지: og:image, twitter:image, <img>/<source> 등에서 이미지 후보 추출 */
export function parseHtmlPage(html: string, base: URL): PageMeta {
  const metas = tags(html, "meta");
  const meta = (key: string) => metas.find((m) => (m.property ?? m.name ?? "").toLowerCase() === key)?.content;
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const title = (meta("og:title") ?? (titleTag ? decodeEntities(titleTag) : undefined))?.trim();
  const description = (meta("og:description") ?? meta("description"))?.trim();

  const seen = new Set<string>();
  const images: ScrapeItem[] = [];
  const add = (src: string | null | undefined, extra: Partial<ScrapeItem> = {}) => {
    if (!src) return;
    const abs = absolutize(src, base);
    if (!abs || JUNK.test(abs)) return;
    const key = abs.replace(/[?#].*$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    images.push({ imageUrl: abs, ...extra });
  };

  for (const key of ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"]) {
    const w = Number(meta("og:image:width")) || undefined;
    const h = Number(meta("og:image:height")) || undefined;
    add(meta(key), key.startsWith("og") ? { width: w, height: h, title } : { title });
  }
  for (const link of tags(html, "link")) if ((link.rel ?? "").toLowerCase() === "image_src") add(link.href);

  for (const img of tags(html, "img")) {
    const w = Number(img.width) || undefined;
    const h = Number(img.height) || undefined;
    if ((w && w < 64) || (h && h < 64)) continue;
    const srcset = img["data-srcset"] ?? img.srcset;
    const src =
      (srcset && largestFromSrcset(srcset)) ??
      img["data-src"] ??
      img["data-original"] ??
      img["data-lazy-src"] ??
      img["data-url"] ??
      img.src;
    add(src, { title: img.alt?.trim() || undefined, width: w, height: h });
  }
  for (const source of tags(html, "source")) {
    const srcset = source["data-srcset"] ?? source.srcset;
    if (srcset && (!source.type || source.type.startsWith("image"))) add(largestFromSrcset(srcset));
  }
  return { title, description, images: images.slice(0, MAX_ITEMS) };
}

// ─── Pinterest ──────────────────────────────────────────────

export function isPinterestHost(host: string): boolean {
  return /(^|\.)pinterest\.[a-z.]+$/i.test(host) || host === "pin.it";
}

/** i.pinimg.com/236x/ab/cd/ef/hash.jpg → 원하는 크기로 */
export function resizePinimg(url: string, size: "736x" | "originals" = "736x"): string {
  return url.replace(/(i\.pinimg\.com\/)(\d+x(?:\d+)?(?:_[a-z]+)?|originals)\//i, `$1${size}/`);
}

function pinimgKey(url: string): string {
  return url.replace(/^.*i\.pinimg\.com\/[^/]+\//i, "").replace(/\.\w+$/, "");
}

/** 핀 상세 HTML → 원본 이미지 */
export function parsePinterestPin(html: string, base: URL): { title?: string; description?: string; item?: ScrapeItem } {
  const page = parseHtmlPage(html, base);
  const orig = html.match(/"orig"\s*:\s*\{([^{}]*)\}/);
  let item: ScrapeItem | undefined;
  if (orig) {
    const body = orig[1];
    const url = body.match(/"url"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    const width = Number(body.match(/"width"\s*:\s*(\d+)/)?.[1]) || undefined;
    const height = Number(body.match(/"height"\s*:\s*(\d+)/)?.[1]) || undefined;
    if (url) item = { imageUrl: url, width, height };
  }
  if (!item) {
    const og = page.images.find((i) => /pinimg\.com/.test(i.imageUrl)) ?? page.images[0];
    if (og) item = { imageUrl: resizePinimg(og.imageUrl, "736x"), width: og.width, height: og.height };
  }
  const title = page.title?.replace(/\s*\|\s*Pinterest.*$/i, "").trim();
  if (item) {
    item.title = title;
    item.sourceUrl = base.href;
  }
  return { title, description: page.description, item };
}

/** 보드/프로필 RSS → 핀 목록 */
export function parsePinterestRss(xml: string): { title?: string; items: ScrapeItem[] } {
  const channelTitle = xml.match(/<channel>[\s\S]*?<title>([\s\S]*?)<\/title>/i)?.[1];
  const items: ScrapeItem[] = [];
  const seen = new Set<string>();
  for (const block of xml.split(/<item>/i).slice(1)) {
    const title = block.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
    const link = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
    const desc = decodeEntities(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "").replace(/<!\[CDATA\[|\]\]>/g, "");
    const src = desc.match(/<img[^>]+src="([^"]+)"/i)?.[1];
    if (!src) continue;
    const imageUrl = resizePinimg(src, "736x");
    const key = pinimgKey(imageUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      imageUrl,
      title: title ? decodeEntities(title.replace(/<!\[CDATA\[|\]\]>/g, "")).trim() || undefined : undefined,
      sourceUrl: link,
    });
  }
  return { title: channelTitle ? decodeEntities(channelTitle.replace(/<!\[CDATA\[|\]\]>/g, "")).trim() : undefined, items };
}

/** 보드/검색 HTML 에 박혀있는 pinimg 이미지들 (RSS 실패 시 대체 수단) */
export function extractPinimgUrls(html: string): ScrapeItem[] {
  const found = html.match(/https?:\\?\/\\?\/i\.pinimg\.com\\?\/[^"'\s)\\]+?\.(?:jpe?g|png|webp|gif)/gi) ?? [];
  const seen = new Set<string>();
  const items: ScrapeItem[] = [];
  for (const raw of found) {
    const url = raw.replace(/\\\//g, "/");
    if (/\/(\d{2}x\d{2}|75x75_RS|30x30_RS|140x140_RS|user|avatars?)\//i.test(url)) continue;
    const key = pinimgKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ imageUrl: resizePinimg(url, "736x") });
  }
  return items.slice(0, MAX_ITEMS);
}

type PinterestUrlKind = { type: "pin" } | { type: "board"; user: string; board: string } | { type: "profile"; user: string } | { type: "other" };

export function classifyPinterestUrl(url: URL): PinterestUrlKind {
  const parts = url.pathname.split("/").filter(Boolean);
  const reserved = new Set(["pin", "search", "ideas", "today", "explore", "business", "settings", "_"]);
  if (parts[0] === "pin") return { type: "pin" };
  if (parts.length >= 2 && !reserved.has(parts[0]) && !["_saved", "_created", "pins"].includes(parts[1])) {
    return { type: "board", user: parts[0], board: parts[1] };
  }
  if (parts.length >= 1 && !reserved.has(parts[0])) return { type: "profile", user: parts[0] };
  return { type: "other" };
}

// ─── entry ──────────────────────────────────────────────────

async function fetchText(url: URL, accept = "text/html,application/xhtml+xml,*/*;q=0.8") {
  const { res, finalUrl } = await safeFetch(url, { headers: { accept } });
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("image/")) {
    await res.body?.cancel();
    return { finalUrl, image: true as const, text: "", ok: res.ok, status: res.status };
  }
  const buf = await readLimited(res, 8 * 1024 * 1024);
  if (sniffImageType(buf)) return { finalUrl, image: true as const, text: "", ok: res.ok, status: res.status };
  return { finalUrl, image: false as const, text: buf.toString("utf8"), ok: res.ok, status: res.status };
}

export async function scrapeUrl(raw: string): Promise<ScrapeResult> {
  const url = normalizeUrl(raw);

  // 이미지 확장자면 바로 이미지로 취급
  if (/\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i.test(url.pathname)) {
    return { kind: "image", url: url.href, items: [{ imageUrl: url.href }] };
  }

  const page = await fetchText(url);
  if (page.image) return { kind: "image", url: page.finalUrl.href, items: [{ imageUrl: page.finalUrl.href }] };
  const finalUrl = page.finalUrl;

  if (isPinterestHost(finalUrl.hostname)) {
    const kind = classifyPinterestUrl(finalUrl);
    if (kind.type === "pin") {
      const pin = parsePinterestPin(page.text, finalUrl);
      if (!pin.item) throw new FetchError("핀에서 이미지를 찾지 못했어요", 422);
      return { kind: "pinterest-pin", url: finalUrl.href, title: pin.title, description: pin.description, items: [pin.item] };
    }
    if (kind.type === "board" || kind.type === "profile") {
      const rssPath = kind.type === "board" ? `/${kind.user}/${kind.board}.rss` : `/${kind.user}/feed.rss`;
      try {
        const rss = await fetchText(new URL(rssPath, finalUrl), "application/rss+xml,application/xml,text/xml,*/*");
        if (rss.ok && !rss.image) {
          const parsed = parsePinterestRss(rss.text);
          if (parsed.items.length) {
            return { kind: "pinterest-board", url: finalUrl.href, title: parsed.title, items: parsed.items.slice(0, MAX_ITEMS) };
          }
        }
      } catch {
        // RSS 가 막혀 있으면 HTML 에서 추출
      }
    }
    const items = extractPinimgUrls(page.text);
    const meta = parseHtmlPage(page.text, finalUrl);
    if (!items.length) throw new FetchError("핀터레스트 페이지에서 이미지를 찾지 못했어요. 핀(개별) 링크나 공개 보드 링크를 사용해 보세요.", 422);
    return { kind: "pinterest-board", url: finalUrl.href, title: meta.title, items };
  }

  if (!page.ok) throw new FetchError(`페이지를 열 수 없어요 (HTTP ${page.status})`, 502);
  const meta = parseHtmlPage(page.text, finalUrl);
  if (!meta.images.length) throw new FetchError("페이지에서 이미지를 찾지 못했어요", 422);
  return {
    kind: "webpage",
    url: finalUrl.href,
    title: meta.title,
    description: meta.description,
    items: meta.images.map((i) => ({ ...i, sourceUrl: finalUrl.href, title: i.title ?? meta.title })),
  };
}
