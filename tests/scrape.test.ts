import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "../server/net";
import {
  classifyPinterestUrl,
  extractPinimgUrls,
  largestFromSrcset,
  parseHtmlPage,
  parsePinterestPin,
  parsePinterestRss,
  resizePinimg,
} from "../server/scrape";

describe("web page parsing", () => {
  const html = `<!doctype html><html><head>
    <title>Arena &amp; Store | Example</title>
    <meta property="og:title" content="Arena Megastore">
    <meta property="og:image" content="/img/hero.jpg"><meta property="og:image:width" content="1600"><meta property="og:image:height" content="900">
    <link rel="icon" href="/favicon.ico">
  </head><body>
    <img src="/img/a.jpg" alt="Kit wall" width="800" height="600">
    <img data-src="https://cdn.example.com/lazy.webp" src="data:image/gif;base64,AAAA">
    <img srcset="/img/s-400.jpg 400w, /img/s-1600.jpg 1600w, /img/s-800.jpg 800w">
    <img src="/img/pixel.gif" width="1" height="1">
    <img src="/img/sprite.png">
    <picture><source srcset="/img/p.avif 1x, /img/p@2x.avif 2x" type="image/avif"></picture>
    <img src="/img/a.jpg?dup=1">
  </body></html>`;
  const page = parseHtmlPage(html, new URL("https://www.example.com/story/1"));

  it("제목·og:image·img/srcset/lazy 이미지 추출, 잡이미지 제외", () => {
    expect(page.title).toBe("Arena Megastore");
    expect(page.images.map((i) => i.imageUrl)).toEqual([
      "https://www.example.com/img/hero.jpg",
      "https://www.example.com/img/a.jpg",
      "https://cdn.example.com/lazy.webp",
      "https://www.example.com/img/s-1600.jpg",
      "https://www.example.com/img/p@2x.avif",
    ]);
    expect(page.images[0]).toMatchObject({ width: 1600, height: 900 });
    expect(page.images[1].title).toBe("Kit wall");
  });

  it("srcset 에서 가장 큰 후보", () => {
    expect(largestFromSrcset("a.jpg 1x, b.jpg 3x, c.jpg 2x")).toBe("b.jpg");
  });
});

describe("pinterest", () => {
  it("핀 HTML 에서 원본(orig) 이미지와 크기", () => {
    const html = `<html><head><meta property="og:title" content="Neon star sign | Pinterest"><meta property="og:image" content="https://i.pinimg.com/736x/ab/cd/ef/abcdef.jpg"></head>
      <script id="__PWS_DATA__">{"images":{"236x":{"url":"https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg"},"orig":{"width":1080,"height":1350,"url":"https:\\u002F\\u002Fi.pinimg.com\\u002Foriginals\\u002Fab\\u002Fcd\\u002Fef\\u002Fabcdef.jpg"}}}</script></html>`;
    const pin = parsePinterestPin(html, new URL("https://www.pinterest.com/pin/123/"));
    expect(pin.title).toBe("Neon star sign");
    expect(pin.item).toEqual({
      imageUrl: "https://i.pinimg.com/originals/ab/cd/ef/abcdef.jpg",
      width: 1080,
      height: 1350,
      title: "Neon star sign",
      sourceUrl: "https://www.pinterest.com/pin/123/",
    });
  });

  it("orig 가 없으면 og:image", () => {
    const html = `<meta property="og:image" content="https://i.pinimg.com/236x/11/22/33/x.jpg">`;
    expect(parsePinterestPin(html, new URL("https://pinterest.com/pin/1/")).item?.imageUrl).toBe("https://i.pinimg.com/736x/11/22/33/x.jpg");
  });

  it("보드 RSS 파싱 (크기 업그레이드·중복 제거)", () => {
    const xml = `<?xml version="1.0"?><rss><channel><title>Stadium Ideas</title>
      <item><title>Star gate</title><link>https://www.pinterest.com/pin/1/</link><description>&lt;a href="/pin/1/"&gt;&lt;img src="https://i.pinimg.com/236x/aa/bb/cc/one.jpg"&gt;&lt;/a&gt;</description></item>
      <item><title><![CDATA[Neon & sign]]></title><link>https://www.pinterest.com/pin/2/</link><description><![CDATA[<a href="/pin/2/"><img src="https://i.pinimg.com/236x/dd/ee/ff/two.png"></a>]]></description></item>
      <item><title>dup</title><link>x</link><description>&lt;img src="https://i.pinimg.com/474x/aa/bb/cc/one.jpg"&gt;</description></item>
    </channel></rss>`;
    const rss = parsePinterestRss(xml);
    expect(rss.title).toBe("Stadium Ideas");
    expect(rss.items).toEqual([
      { imageUrl: "https://i.pinimg.com/736x/aa/bb/cc/one.jpg", title: "Star gate", sourceUrl: "https://www.pinterest.com/pin/1/" },
      { imageUrl: "https://i.pinimg.com/736x/dd/ee/ff/two.png", title: "Neon & sign", sourceUrl: "https://www.pinterest.com/pin/2/" },
    ]);
  });

  it("HTML 에 박힌 pinimg URL 추출 (아바타 제외)", () => {
    const html = `"url":"https:\\/\\/i.pinimg.com\\/564x\\/12\\/34\\/56\\/a.jpg" <img src="https://i.pinimg.com/75x75_RS/99/99/99/avatar.jpg"> https://i.pinimg.com/originals/12/34/56/a.jpg https://i.pinimg.com/236x/77/88/99/b.webp`;
    expect(extractPinimgUrls(html).map((i) => i.imageUrl)).toEqual([
      "https://i.pinimg.com/736x/12/34/56/a.jpg",
      "https://i.pinimg.com/736x/77/88/99/b.webp",
    ]);
  });

  it("URL 종류 판별", () => {
    expect(classifyPinterestUrl(new URL("https://www.pinterest.co.kr/pin/1234/"))).toEqual({ type: "pin" });
    expect(classifyPinterestUrl(new URL("https://www.pinterest.com/jane/stadium-ideas/"))).toEqual({ type: "board", user: "jane", board: "stadium-ideas" });
    expect(classifyPinterestUrl(new URL("https://www.pinterest.com/jane/"))).toEqual({ type: "profile", user: "jane" });
    expect(classifyPinterestUrl(new URL("https://www.pinterest.com/search/pins/?q=neon"))).toEqual({ type: "other" });
  });

  it("pinimg 크기 변환", () => {
    expect(resizePinimg("https://i.pinimg.com/236x/aa/bb/cc/x.jpg", "originals")).toBe("https://i.pinimg.com/originals/aa/bb/cc/x.jpg");
  });
});

describe("SSRF guard", () => {
  it("사설/로컬 주소 판별", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.4", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
