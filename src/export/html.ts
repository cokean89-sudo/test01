// 단일 HTML 파일로 내보내기 — 서버 없이도 열리는 웹 문서
// (링크 이미지는 원본 링크 그대로, 앱에 올린 이미지는 로그인 없이도 보이게 파일 안에 넣는다)

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isStoredImage } from "../../shared/files";
import type { DocumentData } from "../../shared/types";
import { PAGE_CSS, PageView, pageSize } from "../components/PageView";

function absolutize(doc: DocumentData): DocumentData {
  const copy = structuredClone(doc);
  for (const p of copy.pages) {
    for (const el of p.elements) {
      if (el.type === "image" && el.src && !/^(https?:|data:)/i.test(el.src)) el.src = new URL(el.src, location.href).href;
    }
  }
  return copy;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export function buildHtml(input: DocumentData): string {
  const doc = absolutize(input);
  const { W, H } = pageSize(doc.settings);
  const fontLinks = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
    .filter((l) => /fonts\.googleapis|pretendard/.test(l.href))
    .map((l) => `<link rel="stylesheet" href="${l.href}">`)
    .join("\n");
  const pages = doc.pages
    .map(
      (page, i) =>
        `<section class="pg" id="p${i + 1}">${renderToStaticMarkup(createElement(PageView, { page, settings: doc.settings, index: i, total: doc.pages.length, mode: "view", docTitle: doc.title }))}</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(doc.title)}</title>
${fontLinks}
<style>
${PAGE_CSS}
html,body{margin:0;background:#1c1c1e;font-family:Pretendard,system-ui,sans-serif}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 20px;background:rgba(28,28,30,.92);color:#fff;backdrop-filter:blur(8px)}
.bar strong{font-size:14px}.bar span{flex:1}
.bar button{background:#fff;color:#111;border:0;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.pages{display:flex;flex-direction:column;align-items:center;gap:28px;padding:28px 16px 80px}
.pg{width:min(1200px,100%);box-shadow:0 6px 30px rgba(0,0,0,.35)}
body.present{overflow:hidden;background:#000}
body.present .bar{display:none}
body.present .pages{padding:0;gap:0;height:100vh;justify-content:center}
body.present .pg{display:none;width:min(100vw,calc(100vh*${W}/${H}));box-shadow:none}
body.present .pg.cur{display:block}
@media print{@page{size:${W}pt ${H}pt;margin:0}body{background:#fff}.bar{display:none}.pages{padding:0;gap:0}.pg{width:${W}pt;box-shadow:none;break-after:page}}
</style>
</head>
<body>
<div class="bar"><strong>${escapeHtml(doc.title)}</strong><span></span><button onclick="present(0)">발표 모드 (P)</button><button onclick="print()">인쇄</button></div>
<div class="pages">
${pages}
</div>
<script>
var cur=-1,pgs=[].slice.call(document.querySelectorAll('.pg'));
function show(i){cur=Math.max(0,Math.min(pgs.length-1,i));pgs.forEach(function(p,k){p.classList.toggle('cur',k===cur)})}
function present(i){document.body.classList.add('present');show(i);if(document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(function(){})}
function exit(){document.body.classList.remove('present');cur=-1;if(document.fullscreenElement)document.exitFullscreen()}
document.addEventListener('keydown',function(e){
  if(e.key==='p'||e.key==='P'){if(cur<0)present(0);return}
  if(cur<0)return;
  if(['ArrowRight','ArrowDown','PageDown',' '].indexOf(e.key)>=0)show(cur+1);
  else if(['ArrowLeft','ArrowUp','PageUp'].indexOf(e.key)>=0)show(cur-1);
  else if(e.key==='Escape')exit();
});
document.addEventListener('fullscreenchange',function(){if(!document.fullscreenElement&&cur>=0)exit()});
pgs.forEach(function(p,k){p.addEventListener('click',function(){if(cur>=0)show(cur+1)})});
</script>
</body>
</html>`;
}

/** 앱에 올린 이미지(/api/files/…)는 팀원만 볼 수 있으니, 받은 사람도 보이도록 data: 로 바꿔 넣는다 */
export async function inlineStoredImages(doc: DocumentData): Promise<DocumentData> {
  const copy = structuredClone(doc);
  const cache = new Map<string, Promise<string | null>>();
  const toData = (src: string) => {
    if (!cache.has(src))
      cache.set(
        src,
        fetch(src, { credentials: "same-origin" })
          .then((r) => (r.ok ? r.blob() : null))
          .then(
            (b) =>
              b &&
              new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(String(fr.result));
                fr.onerror = () => reject(fr.error);
                fr.readAsDataURL(b);
              }),
          )
          .catch(() => null),
      );
    return cache.get(src)!;
  };
  for (const p of copy.pages) {
    for (const el of p.elements) {
      if (el.type === "image" && isStoredImage(el.src)) el.src = (await toData(el.src)) ?? el.src;
    }
  }
  return copy;
}

export async function exportHtml(doc: DocumentData) {
  const blob = new Blob([buildHtml(await inlineStoredImages(doc))], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${doc.title || "document"}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
