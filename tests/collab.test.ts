import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeDocuments } from "../shared/merge";
import type { DocumentData, Page } from "../shared/types";
import { urlKey } from "../shared/urlKey";
import { defaultSettings } from "../src/lib/defaults";

const page = (id: string, texts: Record<string, string>, extra: Partial<Page> = {}): Page => ({
  id,
  kind: "blank",
  layout: { mode: "grid", columns: 3, rows: 0, gap: 6, seed: 0 },
  area: { x: 0, y: 0, w: 100, h: 100 },
  elements: Object.entries(texts).map(([eid, text]) => ({ id: eid, type: "text" as const, role: "free" as const, text, x: 0, y: 0, w: 10, h: 10 })),
  ...extra,
});
const doc = (pages: Page[], title = "문서"): DocumentData => ({ id: "d", title, createdAt: 0, updatedAt: 0, settings: defaultSettings(), pages });
const texts = (d: DocumentData) => d.pages.map((p) => p.elements.map((e) => (e.type === "text" ? e.text : "")).join(","));

describe("mergeDocuments", () => {
  const base = doc([page("p1", { a: "A", b: "B" }), page("p2", { c: "C" })]);

  it("같은 페이지의 서로 다른 요소 편집을 모두 살린다", () => {
    const mine = structuredClone(base);
    (mine.pages[0].elements[0] as { text: string }).text = "A1";
    const theirs = structuredClone(base);
    (theirs.pages[0].elements[1] as { text: string }).text = "B2";
    const r = mergeDocuments(base, mine, theirs);
    expect(texts(r.value)).toEqual(["A1,B2", "C"]);
    expect(r.conflicts).toEqual([]);
  });

  it("같은 요소의 서로 다른 속성은 합치고, 같은 속성 충돌은 내 것을 쓴다", () => {
    const mine = structuredClone(base);
    Object.assign(mine.pages[0].elements[0], { text: "mine", x: 5 });
    const theirs = structuredClone(base);
    Object.assign(theirs.pages[0].elements[0], { text: "theirs", y: 7 });
    const r = mergeDocuments(base, mine, theirs);
    expect(r.value.pages[0].elements[0]).toMatchObject({ text: "mine", x: 5, y: 7 });
    expect(r.conflicts).toEqual(["element:a.text"]);
  });

  it("페이지 추가·삭제·순서 변경을 합친다", () => {
    const mine = structuredClone(base);
    mine.pages.reverse(); // 순서 변경
    const theirs = structuredClone(base);
    theirs.pages.splice(1, 0, page("p3", { d: "D" })); // p1 뒤에 추가
    const r = mergeDocuments(base, mine, theirs);
    expect(r.value.pages.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);

    const del = structuredClone(base);
    del.pages = del.pages.filter((p) => p.id !== "p2");
    expect(mergeDocuments(base, del, structuredClone(base)).value.pages.map((p) => p.id)).toEqual(["p1"]);
  });

  it("한쪽이 지운 페이지를 다른 쪽이 고쳤으면 고친 내용을 살린다", () => {
    const mine = structuredClone(base);
    mine.pages = mine.pages.filter((p) => p.id !== "p2");
    const theirs = structuredClone(base);
    (theirs.pages[1].elements[0] as { text: string }).text = "C!";
    expect(texts(mergeDocuments(base, mine, theirs).value)).toEqual(["A,B", "C!"]);
  });

  it("문서 설정(양식)과 제목도 병합", () => {
    const mine = structuredClone(base);
    mine.title = "새 제목";
    const theirs = structuredClone(base);
    theirs.settings.footer = { ...theirs.settings.footer, left: "EMART" };
    const r = mergeDocuments(base, mine, theirs);
    expect(r.value.title).toBe("새 제목");
    expect(r.value.settings.footer.left).toBe("EMART");
  });
});

describe("urlKey (중복 판별)", () => {
  it("핀터레스트 이미지는 크기와 무관하게 같은 키", () => {
    const k = urlKey("https://i.pinimg.com/236x/ab/cd/ef/abcdef0123.jpg");
    expect(urlKey("https://i.pinimg.com/originals/ab/cd/ef/abcdef0123.png")).toBe(k);
    expect(urlKey("https://i.pinimg.com/736x/ab/cd/ef/abcdef0124.jpg")).not.toBe(k);
  });
  it("www·프로토콜·추적 파라미터·파라미터 순서 무시", () => {
    const k = urlKey("https://www.example.com/img/a.jpg?w=800&utm_source=x");
    expect(urlKey("http://example.com/img/a.jpg?w=800#top")).toBe(k);
    expect(urlKey("https://example.com/img/a.jpg?fbclid=1&w=800")).toBe(k);
    expect(urlKey("https://example.com/img/a.jpg?w=400")).not.toBe(k);
  });
});

describe("소셜 로그인 프로필 파싱", () => {
  afterEach(() => vi.unstubAllGlobals());

  const mockFetch = (responses: Record<string, unknown>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const key = Object.keys(responses).find((k) => url.startsWith(k))!;
        return new Response(JSON.stringify(responses[key]), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

  it("카카오: 인증된 메일만 verified", async () => {
    process.env.KAKAO_CLIENT_ID = "test";
    vi.resetModules();
    const { fetchProfile } = await import("../server/routes/auth");
    mockFetch({
      "https://kauth.kakao.com/oauth/token": { access_token: "t" },
      "https://kapi.kakao.com/v2/user/me": { id: 42, kakao_account: { email: "Kim@Kakao.com", is_email_valid: true, is_email_verified: true, profile: { nickname: "김기획" } } },
    });
    expect(await fetchProfile("kakao", "code", "state")).toEqual({ id: "42", email: "kim@kakao.com", emailVerified: true, name: "김기획" });
    mockFetch({
      "https://kauth.kakao.com/oauth/token": { access_token: "t" },
      "https://kapi.kakao.com/v2/user/me": { id: 43, kakao_account: { email: "x@y.com", is_email_verified: false } },
    });
    expect((await fetchProfile("kakao", "code", "state")).emailVerified).toBe(false);
  });

  it("네이버: @naver.com 메일만 verified 로 취급", async () => {
    process.env.NAVER_CLIENT_ID = "test";
    process.env.NAVER_CLIENT_SECRET = "secret";
    vi.resetModules();
    const { fetchProfile } = await import("../server/routes/auth");
    mockFetch({
      "https://nid.naver.com/oauth2.0/token": { access_token: "t" },
      "https://openapi.naver.com/v1/nid/me": { resultcode: "00", response: { id: "n1", email: "lee@naver.com", name: "이디자" } },
    });
    expect(await fetchProfile("naver", "code", "state")).toEqual({ id: "n1", email: "lee@naver.com", emailVerified: true, name: "이디자" });
    mockFetch({
      "https://nid.naver.com/oauth2.0/token": { access_token: "t" },
      "https://openapi.naver.com/v1/nid/me": { resultcode: "00", response: { id: "n2", email: "lee@gmail.com", name: "이" } },
    });
    expect((await fetchProfile("naver", "code", "state")).emailVerified).toBe(false);
  });
});
