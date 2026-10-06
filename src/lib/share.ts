// 휴대폰 공유 메뉴로 받은 이미지 · 링크 꺼내기 — public/sw.js 가 Cache Storage("rb-share")에 넣어 둔 것을 한 번만 꺼내고 지운다.

const SHARE_CACHE = "rb-share";

export interface SharedItems {
  files: File[];
  /** 링크 · 글 (레퍼런스 추가 창의 링크 칸에 들어간다) */
  text: string;
}

export async function takeShared(id: string): Promise<SharedItems | null> {
  if (!/^[a-z0-9]{6,40}$/.test(id) || typeof caches === "undefined") return null;
  const cache = await caches.open(SHARE_CACHE);
  const metaRes = await cache.match(`/__share/${id}/meta`);
  if (!metaRes) return null;
  const meta = (await metaRes.json()) as { title: string; text: string; url: string; files: { name: string; type: string }[] };
  const files: File[] = [];
  for (let i = 0; i < meta.files.length; i++) {
    const r = await cache.match(`/__share/${id}/${i}`);
    if (r) files.push(new File([await r.blob()], meta.files[i].name, { type: meta.files[i].type }));
    await cache.delete(`/__share/${id}/${i}`);
  }
  await cache.delete(`/__share/${id}/meta`);
  return { files, text: [meta.url, meta.text].filter(Boolean).join("\n") };
}

/** 서비스 워커 등록 — 운영 빌드에서만 (개발 중에는 화면이 옛것으로 남지 않게) */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
