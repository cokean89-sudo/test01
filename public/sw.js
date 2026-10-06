// RefBoard 서비스 워커 — 휴대폰 공유 메뉴(Web Share Target)로 받은 이미지 · 링크만 처리한다.
// 화면 · API 는 캐시하지 않는다 (늘 서버의 최신 화면을 쓰도록).
//
//   공유 메뉴 → POST /share-target (사진 = images, 링크 = url · text)
//   → 받은 것을 잠깐 Cache Storage("rb-share")에 넣고 → /#/share/<id> 로 연다
//   → 앱이 꺼내서 '레퍼런스 추가' 창에 넣고 바로 지운다 (로그인 전이면 로그인 뒤에)

const SHARE_CACHE = "rb-share";
const MAX_FILES = 30;
/** 하루 넘게 꺼내지 않은 공유는 지운다 */
const MAX_AGE = 24 * 60 * 60 * 1000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(Promise.all([self.clients.claim(), sweepOld()])));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || url.origin !== self.location.origin || url.pathname !== "/share-target") return;
  event.respondWith(receiveShare(event.request));
});

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const cache = await caches.open(SHARE_CACHE);
    const files = form
      .getAll("images")
      .filter((f) => f && typeof f === "object" && f.size > 0 && /^image\//.test(f.type))
      .slice(0, MAX_FILES);
    const meta = {
      title: String(form.get("title") || ""),
      text: String(form.get("text") || ""),
      url: String(form.get("url") || ""),
      files: files.map((f, i) => ({ name: f.name || `shared-${i + 1}`, type: f.type })),
      at: Date.now(),
    };
    await Promise.all(files.map((f, i) => cache.put(`/__share/${id}/${i}`, new Response(f, { headers: { "content-type": f.type } }))));
    await cache.put(`/__share/${id}/meta`, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
    return Response.redirect(new URL(`/#/share/${id}`, self.location.origin).href, 303);
  } catch {
    return Response.redirect(new URL("/#/share/failed", self.location.origin).href, 303);
  }
}

async function sweepOld() {
  const cache = await caches.open(SHARE_CACHE);
  for (const req of await cache.keys()) {
    if (!req.url.endsWith("/meta")) continue;
    const meta = await (await cache.match(req))?.json().catch(() => null);
    if (meta && Date.now() - meta.at < MAX_AGE) continue;
    const prefix = req.url.slice(0, -"meta".length);
    for (const k of await cache.keys()) if (k.url.startsWith(prefix)) await cache.delete(k);
  }
}
