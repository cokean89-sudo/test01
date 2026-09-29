import { describe, expect, it } from "vitest";
import { describeUserAgent, maskSensitiveUrl, safeFileName, sniffImage } from "../shared/feedback";

describe("의견 보내기 도우미", () => {
  it("브라우저·OS 를 읽기 쉽게", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15")).toBe("Safari 18.1 · macOS");
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")).toBe("Edge 131 · Windows 10/11");
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1")).toBe("Chrome 126 · iOS 17.5");
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36")).toBe(
      "Samsung Internet 25 · Android 14",
    );
    expect(describeUserAgent("")).toBe("알 수 없는 브라우저 · 알 수 없는 OS");
  });

  it("주소 속 토큰을 가린다", () => {
    expect(maskSensitiveUrl("https://a.com/#/invite/abcDEF123")).toBe("https://a.com/#/invite/***");
    expect(maskSensitiveUrl("https://a.com/#/verify/tok?x=1")).toBe("https://a.com/#/verify/***?x=1");
    expect(maskSensitiveUrl("https://a.com/?token=abc&page=2")).toBe("https://a.com/?token=***&page=2");
    expect(maskSensitiveUrl("https://a.com/#/edit/doc1")).toBe("https://a.com/#/edit/doc1");
  });

  it("파일 앞부분으로 이미지 형식 판별", () => {
    const b = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
    expect(sniffImage(b("89504e470d0a1a0a00"))).toBe("image/png");
    expect(sniffImage(b("ffd8ffe000"))).toBe("image/jpeg");
    expect(sniffImage(b("474946383961"))).toBe("image/gif");
    expect(sniffImage(b("52494646000000005745425056503820"))).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg xmlns="))).toBeNull();
  });

  it("첨부 파일 이름 정리", () => {
    expect(safeFileName("화면 캡처 2026-09-29.PNG", "image/png", 0)).toBe("화면 캡처 2026-09-29.png");
    expect(safeFileName("..\\..\\a<b>.jpg", "image/jpeg", 1)).toBe("ab.jpg");
    expect(safeFileName("", "image/webp", 2)).toBe("screenshot-3.webp");
  });
});
