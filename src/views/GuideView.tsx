// TIP — 사용 가이드. 브랜드 · 경쟁사 · 상품 사례(가상 예시)로 모으기 → 정리 → 문서 → 공유까지 순서대로 설명한다.
// 핀터레스트 링크 복사(공유 → 링크 복사 / 이미지 우클릭 → 이미지 주소 복사)는 화면 모형으로 보여준다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ROLE_RANK, type Reference } from "../../shared/types";
import { Icon, type IconName } from "../components/icons";
import { PageView } from "../components/PageView";
import { Button } from "../components/ui";
import { createCasePage, createCoverPage, createReferencePage, createSectionPage } from "../layout/templates";
import { defaultSettings } from "../lib/defaults";
import { SAMPLE_CASES, SAMPLE_IMAGES, sampleCase, sampleImage } from "../lib/dummy";
import { navigate } from "../lib/router";
import { useCurrentTeam, useSession } from "../store/session";
import { useUI } from "../store/ui";

/** 가이드 예시 이미지 — 샘플 사례(src/lib/dummy.ts, public/guide 의 직접 그린 일러스트) */
function ref(key: string): Reference {
  const i = sampleImage(key);
  return { id: "g-" + key, imageUrl: i.src, title: i.title, tags: i.tags, kind: "image", width: i.w, height: i.h, source: "manual", createdAt: 0 };
}

const STEPS: { id: string; label: string }[] = [
  { id: "pinterest", label: "핀터레스트에서 가져오기" },
  { id: "web", label: "다른 사이트·파일" },
  { id: "tags", label: "키워드 달고 정리하기" },
  { id: "search", label: "찾고 정렬하기" },
  { id: "build", label: "키워드로 문서 만들기" },
  { id: "layout", label: "페이지 다듬기" },
  { id: "export", label: "내보내기 · 발표" },
  { id: "team", label: "팀과 함께 쓰기" },
];

export function GuideView({ section }: { section?: string }) {
  const status = useSession((s) => s.status);
  const team = useCurrentTeam();
  const { openCollect, openBuild } = useUI();
  const canEdit = status === "ready" && !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const [active, setActive] = useState(section ?? STEPS[0].id);
  const scroller = useRef<HTMLDivElement>(null);

  // 주소의 단계로 스크롤 (#/guide/pinterest)
  useEffect(() => {
    if (!section) return;
    document.getElementById("g-" + section)?.scrollIntoView({ block: "start" });
  }, [section]);

  // 지금 보고 있는 단계를 왼쪽 목차에 표시
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id.slice(2));
      },
      { root, rootMargin: "-10% 0px -70% 0px" },
    );
    for (const s of STEPS) {
      const el = document.getElementById("g-" + s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);

  const go = (action: () => void) => (status === "ready" ? action() : navigate("login"));

  return (
    <div className="guide-page" ref={scroller}>
      <section className="guide-hero">
        <div className="guide-hero-inner">
          <span className="eyebrow">
            <Icon name="bulb" size={15} /> TIP · 사용 가이드
          </span>
          <h1>
            레퍼런스 정리부터 보고서까지,
            <br />
            이렇게 하면 쉬워요
          </h1>
          <p>
            가상의 커피 브랜드 &lsquo;모닝루틴&rsquo;의 팝업, 경쟁사 매장, 신상품 패키지를 예시로 처음부터 끝까지 따라해 볼게요. 순서대로 봐도 좋고, 필요한 단계만 골라 봐도 돼요.
          </p>
          <div className="guide-hero-strip" aria-hidden="true">
            {SAMPLE_IMAGES.slice(0, 8).map((i) => (
              <img key={i.key} src={i.src} alt="" />
            ))}
          </div>
        </div>
      </section>

      <div className="guide-wrap">
        <nav className="guide-nav" aria-label="가이드 목차">
          {STEPS.map((s, i) => (
            <a
              key={s.id}
              href={"#/guide/" + s.id}
              className={active === s.id ? "on" : ""}
              onClick={(e) => {
                e.preventDefault();
                setActive(s.id);
                document.getElementById("g-" + s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                history.replaceState(null, "", "#/guide/" + s.id);
              }}
            >
              <span>{i + 1}</span>
              {s.label}
            </a>
          ))}
        </nav>

        <main className="guide-main">
          <PinterestStep onCollect={() => go(() => openCollect())} canEdit={canEdit || status !== "ready"} />
          <WebStep />
          <TagsStep />
          <SearchStep />
          <BuildStep onBuild={() => go(() => openBuild())} canEdit={canEdit || status !== "ready"} />
          <LayoutStep />
          <ExportStep />
          <TeamStep onTeam={() => go(() => navigate("team"))} />
        </main>
      </div>
    </div>
  );
}

function Step({ id, no, title, lead, children }: { id: string; no: number; title: ReactNode; lead: ReactNode; children: ReactNode }) {
  return (
    <section className="guide-step" id={"g-" + id}>
      <header>
        <span className="step-label">STEP {no}</span>
        <h2>{title}</h2>
        <p>{lead}</p>
      </header>
      {children}
    </section>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="tip-box">
      <Icon name="bulb" size={18} />
      <div>{children}</div>
    </div>
  );
}

function Cursor({ x, y }: { x: number | string; y: number | string }) {
  return (
    <svg className="mock-cursor" style={{ left: x, top: y }} viewBox="0 0 24 24">
      <path d="M4 2l15 9-7 1.6L8.6 20z" fill="#191f28" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function BrowserMock({ url, children }: { url: string; children: ReactNode }) {
  return (
    <div className="mock-window" aria-hidden="true">
      <div className="mock-bar">
        <i />
        <i />
        <i />
        <span className="mock-url">{url}</span>
      </div>
      <div className="mock-body">{children}</div>
    </div>
  );
}

// ─── 1. 핀터레스트 ────────────────────────────────────────────

function PinterestStep({ onCollect, canEdit }: { onCollect: () => void; canEdit: boolean }) {
  return (
    <Step
      id="pinterest"
      no={1}
      title="핀터레스트에서 이미지 가져오기"
      lead="이미지를 내려받을 필요 없어요. 링크만 복사해서 붙여넣으면 원본 해상도 이미지를 찾아 연결해 둬요. 두 가지 방법 중 편한 걸 쓰세요."
    >
      <div className="guide-demo">
        <div className="guide-panel">
          <h3>
            <span className="pill">추천</span> 공유 버튼 → 링크 복사
          </h3>
          <BrowserMock url="pinterest.com/pin/1029876…">
            <div className="mock-pin">
              <div className="mock-pin-img">
                <img src={sampleImage("brand-popup").src} alt="" />
              </div>
              <div className="mock-pin-side">
                <div className="mock-icons">
                  <span className="mock-icon">
                    <Icon name="dots" size={16} />
                  </span>
                  <span className="mock-icon hot">
                    <Icon name="upload" size={16} />
                  </span>
                  <span className="mock-save">저장</span>
                </div>
                <div className="mock-pop">
                  <h6>공유</h6>
                  <div className="mock-pop-row">
                    <div className="hot">
                      <b>
                        <Icon name="link" size={16} />
                      </b>
                      링크 복사
                    </div>
                    <div>
                      <b>
                        <Icon name="external" size={15} />
                      </b>
                      메신저
                    </div>
                    <div>
                      <b>
                        <Icon name="file" size={15} />
                      </b>
                      메일
                    </div>
                  </div>
                </div>
                <div className="mock-lines">
                  <i style={{ width: "80%" }} />
                  <i style={{ width: "55%" }} />
                </div>
              </div>
            </div>
          </BrowserMock>
          <ol className="guide-steps">
            <li>핀터레스트에서 원하는 핀을 눌러 크게 열어요.</li>
            <li>
              이미지 옆의 <b>공유</b> 버튼(<Icon name="upload" size={13} />)을 눌러요.
            </li>
            <li>
              <b>링크 복사</b>를 누르면 핀 주소가 복사돼요. 앱에서는 공유 → 링크 복사예요.
            </li>
          </ol>
        </div>

        <div className="guide-panel">
          <h3>
            <span className="pill alt">빠르게</span> 이미지 우클릭 → 이미지 주소 복사
          </h3>
          <BrowserMock url="pinterest.com/search/pins/?q=popup store">
            <div style={{ position: "relative", height: 262 }}>
              <div className="mock-library" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="mock-pin-img">
                  <img src={sampleImage("brand-poster").src} alt="" style={{ aspectRatio: "4/5", objectFit: "cover" }} />
                </div>
                <div className="mock-pin-img">
                  <img src={sampleImage("product-pack").src} alt="" style={{ aspectRatio: "4/5", objectFit: "cover" }} />
                </div>
              </div>
              <Cursor x="30%" y="38%" />
              <div className="mock-ctx" style={{ left: "33%", top: "40%" }}>
                <div>새 탭에서 이미지 열기</div>
                <div>이미지를 다른 이름으로 저장…</div>
                <div>이미지 복사</div>
                <div className="hot">이미지 주소 복사</div>
                <div className="sep" />
                <div>Google 렌즈로 이미지 검색</div>
              </div>
            </div>
          </BrowserMock>
          <ol className="guide-steps">
            <li>검색 결과나 보드에서 원하는 이미지 위에 마우스를 올려요.</li>
            <li>
              마우스 <b>오른쪽 버튼</b>을 눌러요. (맥 트랙패드는 두 손가락 클릭)
            </li>
            <li>
              <b>이미지 주소 복사</b>를 눌러요. 핀을 열지 않고 여러 장을 빠르게 모을 때 좋아요.
            </li>
          </ol>
        </div>
      </div>

      <div className="guide-panel">
        <h3>복사한 링크를 RefBoard에 붙여넣기</h3>
        <div className="mock-paste" aria-hidden="true">
          <span>
            https://pin.it/3xAbCdE
            <br />
            https://i.pinimg.com/originals/8f/2c/…/popup-store.jpg
          </span>
          <Button variant="primary" size="sm" icon="link" tabIndex={-1}>
            가져오기
          </Button>
        </div>
        <ol className="guide-steps">
          <li>
            오른쪽 위 <b>레퍼런스 추가</b>를 누르고 링크를 붙여넣어요. 여러 개는 줄을 바꿔 한 번에 붙여넣으면 돼요.
          </li>
          <li>찾아온 이미지 중 저장할 것만 골라요. 이미 있는 이미지는 &lsquo;중복&rsquo;으로 알려줘요.</li>
          <li>키워드를 달고 저장하면 끝이에요.</li>
        </ol>
        {canEdit && (
          <div className="guide-cta">
            <Button variant="primary" icon="plus" onClick={onCollect}>
              지금 레퍼런스 추가하기
            </Button>
          </div>
        )}
      </div>

      <div className="guide-cards">
        <Tip>
          <b>보드를 통째로</b> 가져오려면 보드 주소(pinterest.com/아이디/보드이름)를 붙여넣으세요. 최근 핀부터 목록으로 보여줘요.
        </Tip>
        <Tip>
          <b>레퍼런스 화면에서 Ctrl+V</b>(맥은 ⌘V)만 눌러도 복사한 링크가 바로 추가 창으로 들어가요.
        </Tip>
        <Tip>
          <b>비공개 보드·비밀 핀</b>은 로그인이 필요해서 가져올 수 없어요. 공개 핀으로 바꾸거나 이미지 주소를 복사해 주세요.
        </Tip>
      </div>
    </Step>
  );
}

// ─── 2. 다른 사이트 ──────────────────────────────────────────

function WebStep() {
  const cards: { icon: IconName; title: string; body: ReactNode }[] = [
    { icon: "link", title: "웹페이지 주소", body: "기사·브랜드 사이트·비핸스 주소를 붙여넣으면 페이지 안의 큰 이미지들을 후보로 보여줘요. 원하는 것만 골라 저장하세요." },
    { icon: "image", title: "이미지 주소", body: "이미지 우클릭 → 이미지 주소 복사로 얻은 주소는 그 이미지 한 장만 바로 가져와요." },
    { icon: "upload", title: "끌어다 놓기", body: "다른 탭의 이미지를 레퍼런스 추가 창으로 끌어다 놓아도 돼요. 이미지 파일은 저장하지 않고 원본 링크로 연결해요." },
  ];
  return (
    <Step id="web" no={2} title="다른 사이트에서도 똑같이" lead="핀터레스트가 아니어도 방법은 같아요. 링크를 붙여넣거나, 이미지를 끌어다 놓으세요.">
      <div className="guide-cards">
        {cards.map((c) => (
          <div key={c.title} className="guide-card">
            <Icon name={c.icon} size={22} />
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
      <Tip>
        이미지는 <b>링크로만</b>연결돼요. 원본이 지워지면 회색 박스로 보이니, 그럴 땐 레퍼런스 상세에서 주소만 바꿔 주면 돼요.
      </Tip>
    </Step>
  );
}

// ─── 3. 키워드 ──────────────────────────────────────────────

function TagsStep() {
  const cards = ["brand-popup", "competitor-shelf", "product-lineup"].map(sampleImage);
  return (
    <Step
      id="tags"
      no={3}
      title="키워드를 달아 두면 나중이 편해요"
      lead="키워드(태그)는 검색과 자동 문서 구성의 기준이 돼요. 한 사례에 속한 이미지들은 '케이스'로 묶어 두면 케이스 스터디 페이지로 한 번에 만들어져요."
    >
      <div className="guide-demo">
        <div className="guide-panel">
          <h3>레퍼런스 카드</h3>
          <div className="mock-library" aria-hidden="true">
            {cards.map((c) => (
              <div key={c.key} className="mock-card">
                <img src={c.src} alt="" />
                <div>
                  <strong>{c.title}</strong>
                  <span className="ref-tags">
                    {c.tags.map((t) => (
                      <span key={t} className="tag tag-sm">
                        {t}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="guide-panel">
          <h3>이렇게 정리해요</h3>
          <ol className="guide-steps">
            <li>
              <b>키워드</b>: 대상·요소·소재를 짧게. 예) 팝업스토어, 패키지, 매대, 쇼윈도
            </li>
            <li>
              <b>케이스</b>: 브랜드·경쟁사·상품 하나를 사례로 묶어요. 예) {SAMPLE_CASES.slice(0, 3).map((c) => `‘${c.name}’(${c.label})`).join(", ")}. 이름·서브타이틀·설명을 적어 두면 문서에 그대로 들어가요.
            </li>
            <li>
              <b>로고</b>: 유형을 &lsquo;로고&rsquo;로 두면 케이스 페이지의 로고 칸에 따로 배치돼요.
            </li>
            <li>
              <b>AI 태그 제안</b>: 이미지를 보고 분야·대상·요소·소재·컬러·무드별로 1~2개씩 제안해요. 눌러서 채택한 것만 저장돼요. 태그는 <b>태그 관리</b>에서 합치고 정리할 수 있어요.
            </li>
          </ol>
        </div>
      </div>
      <Tip>
        같은 이미지를 다시 추가하면 <b>&lsquo;중복&rsquo;</b> 표시와 함께 <b>누가 언제 추가했는지</b> 알려줘요. 새로 만들지 않고 키워드만 합쳐져요.
      </Tip>
    </Step>
  );
}

// ─── 4. 검색 ────────────────────────────────────────────────

function SearchStep() {
  return (
    <Step id="search" no={4} title="키워드만 넣으면 알아서 정렬해요" lead="관련도가 높은 순서로 정렬하고, 태그별로 묶어서 보여줘요. 검색어를 조합하면 더 정확해요.">
      <div className="guide-panel">
        <div className="mock-search" aria-hidden="true">
          <Icon name="search" size={17} />
          <span>
            팝업스토어 <mark>#패키지</mark> "매장 사인" <em>-로고</em>
          </span>
        </div>
        <table className="guide-table">
          <tbody>
            <tr>
              <td>
                <code>팝업스토어 패키지</code>
              </td>
              <td>여러 단어 — 키워드 중 하나라도 있는 이미지를 찾고, 많이 맞을수록 위로. &lsquo;키워드가 모두 있는 것만&rsquo;을 체크하면 전부 있는 이미지만 (키워드가 2개 이상일 때)</td>
            </tr>
            <tr>
              <td>
                <code>#패키지</code>
              </td>
              <td>태그와 정확히 같은 것만</td>
            </tr>
            <tr>
              <td>
                <code>"매장 사인"</code>
              </td>
              <td>띄어쓰기까지 그대로인 문구</td>
            </tr>
            <tr>
              <td>
                <code>-로고</code>
              </td>
              <td>이 단어가 들어간 건 빼기</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Tip>
        여러 장을 <b>Ctrl/Shift+클릭</b>으로 고르면 키워드 추가·케이스 지정·삭제를 한 번에 할 수 있고, <b>선택한 것으로 문서 만들기</b>도 돼요.
      </Tip>
    </Step>
  );
}

// ─── 5. 문서 만들기 ─────────────────────────────────────────

function useSamplePages() {
  return useMemo(() => {
    const s = defaultSettings();
    const cover = createCoverPage(s);
    const brand = sampleCase("brand");
    const section = createSectionPage(s, { title: "Brand & Competitor", subtitle: "01 · Pop-up · Store · Package" });
    const short = createReferencePage(s, {
      title: "Pop-up Store",
      subtitle: "Brand\nSpace Reference",
      description: "브랜드 컬러를 외관 · 쇼윈도 · 포스터까지 이어서 적용한 팝업스토어와 경쟁사 매장 비교",
      images: [ref("brand-popup"), ref("brand-window"), ref("competitor-store"), ref("brand-poster"), ref("product-lineup")],
    });
    const long = createCasePage(s, {
      title: "Case Study",
      subtitle: brand.subtitle,
      highlight: brand.highlight,
      description: brand.description,
      images: brand.images.map((i) => ref(i.key)),
      logos: [],
    });
    return { settings: s, pages: [cover, section, short, long] };
  }, []);
}

function BuildStep({ onBuild, canEdit }: { onBuild: () => void; canEdit: boolean }) {
  const { settings, pages } = useSamplePages();
  const captions: ReactNode[] = [
    <>
      <b>표지</b> — 가운데 제목 + PRESENTED BY 부서명
    </>,
    <>
      <b>간지</b> — 태그 그룹이 여러 개일 때 사이사이에
    </>,
    <>
      <b>짧은 글</b> — 설명이 제목 옆에, 이미지는 전체 폭
    </>,
    <>
      <b>긴 글</b> — 설명이 왼쪽 단으로, 이미지는 2~5단
    </>,
  ];
  return (
    <Step
      id="build"
      no={5}
      title="키워드 하나로 문서가 만들어져요"
      lead="키워드를 넣으면 태그·케이스별로 묶고, 페이지를 나누고, 보고서 양식(A4 가로)에 맞춰 배치까지 해 줘요. 아래는 브랜드 팝업 예시로 만든 페이지예요."
    >
      <div className="guide-pages">
        {pages.slice(0, 3).map((p, i) => (
          <figure key={p.id}>
            <div className="guide-shot">
              <PageView page={p} settings={settings} index={i} total={pages.length} docTitle="Brand Case Study" />
            </div>
            <figcaption>{captions[i]}</figcaption>
          </figure>
        ))}
      </div>
      <div className="guide-demo">
        <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="guide-shot">
            <PageView page={pages[3]} settings={settings} index={3} total={pages.length} docTitle="Brand Case Study" />
          </div>
          <figcaption className="muted small">{captions[3]}</figcaption>
        </figure>
        <div className="guide-panel">
          <h3>만드는 순서</h3>
          <ol className="guide-steps">
            <li>
              오른쪽 위 <b>문서 만들기</b>를 누르고 키워드를 넣어요. 예) 팝업스토어 패키지
            </li>
            <li>
              오른쪽에 <b>그룹 미리보기</b>가 바로 떠요. 그룹 이름을 고치거나 빼고 싶은 그룹의 체크를 해제하세요.
            </li>
            <li>페이지당 이미지 수, 표지·간지 여부를 고르고 만들기를 누르면 편집 화면이 열려요.</li>
            <li>
              <b>생성 후 AI로 작성</b>을 켜 두면 빈 제목·설명·캡션을 AI가 채워요.
            </li>
          </ol>
          {canEdit && (
            <div className="guide-cta">
              <Button variant="primary" icon="sparkle" onClick={onBuild}>
                키워드로 문서 만들기
              </Button>
            </div>
          )}
        </div>
      </div>
      <Tip>
        <b>템플릿 6종</b>(기본 · 클린 비즈니스 · 볼드 브리프 · 뉴트럴 에디토리얼 · 모노 포트폴리오 · 톤온톤)을 썸네일로 보고 고를 수 있어요. 표지 · 목차 · 섹션 구분 · 케이스 스터디 ·
        레퍼런스 그리드 · 경쟁사·상품 비교 · 마무리 페이지가 들어 있고, 편집 중에도 <b>문서 양식 → 템플릿</b>에서 바꾸면 글과 이미지는 그대로 옮겨져요.
      </Tip>
      <Tip>
        부서명은 <b>팀 설정 → 문서 기본값</b>에서 한 번만 정해 두면(기본 &lsquo;OO TEAM&rsquo;) 표지의 PRESENTED BY와 모든 페이지 하단에 자동으로 들어가요.
      </Tip>
    </Step>
  );
}

// ─── 6. 레이아웃 ────────────────────────────────────────────

function LayoutStep() {
  const rows: [string, ReactNode][] = [
    ["방향", "가로 줄(기본) · 세로 열 · 격자 · 모자이크 · 보고서형. 가로 줄은 같은 줄의 높이를, 세로 열은 같은 열의 폭을 맞춰요."],
    ["간격 · 안쪽 여백", "이미지 사이 간격과 이미지 영역 안쪽 여백을 pt 단위로 정해요. 피그마 오토 레이아웃의 Gap · Padding과 같아요."],
    ["줄 수 · 열 수", "자동으로 두면 영역에 가장 잘 맞는 수를 골라요. −/+ 로 직접 정할 수도 있어요."],
    ["꽉 채우기 / 비율 유지", "꽉 채우기는 빈틈없이 채우고(가장자리 살짝 잘림), 비율 유지는 자르지 않고 남는 공간을 비워 둬요."],
    ["정렬", "비율 유지일 때 3×3 칸으로 남는 공간을 어디에 둘지 정해요 (위·가운데·아래 × 왼쪽·가운데·오른쪽)."],
    ["글 배치", "자동으로 두면 설명이 3줄을 넘을 때 왼쪽 단으로 내려가고, 이미지 영역이 알아서 좁아져요. 짧은 글/긴 글로 고정할 수도 있어요."],
  ];
  const keys: [string, string][] = [
    ["V  T  R  O  L", "선택 · 텍스트 · 사각형 · 원 · 선"],
    ["더블클릭 / Enter", "글 고치기 (Esc로 마치기)"],
    ["Ctrl+Z / Ctrl+Shift+Z", "실행 취소 / 다시 실행"],
    ["Ctrl+C · V · D", "복사 · 붙여넣기 · 복제"],
    ["방향키 (+Shift)", "1pt (10pt)씩 옮기기"],
    ["이미지를 다른 이미지 위로", "두 이미지 자리 바꾸기"],
  ];
  return (
    <Step
      id="layout"
      no={6}
      title="페이지는 오토 레이아웃으로 다듬어요"
      lead="편집 화면 오른쪽 '페이지' 탭에서 피그마의 오토 레이아웃처럼 방향·간격·여백·정렬을 바꾸면 이미지가 바로 다시 배치돼요. 글자는 '타이포' 탭에서 역할별로 한 번에 바꿔요."
    >
      <div className="guide-demo single">
        <div className="guide-panel">
          <h3>오토 레이아웃 설정</h3>
          <table className="guide-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="guide-panel">
          <h3>자주 쓰는 단축키</h3>
          <table className="guide-table">
            <tbody>
              {keys.map(([k, v]) => (
                <tr key={k}>
                  <td>
                    {k.split(/\s{2,}/).map((part) => (
                      <span key={part} className="kbd" style={{ marginRight: 4 }}>
                        {part}
                      </span>
                    ))}
                  </td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Tip>
            이미지나 글 상자를 <b>직접 끌어 옮기면</b> 그 요소만 자동 배치에서 빠져요. 되돌리려면 인스펙터에서 &lsquo;자동 레이아웃에 포함&rsquo;·&lsquo;다시 자동으로&rsquo;를 누르세요.
          </Tip>
        </div>
      </div>
    </Step>
  );
}

// ─── 7. 내보내기 ────────────────────────────────────────────

function ExportStep() {
  const cards: { icon: IconName; title: string; body: string }[] = [
    { icon: "printer", title: "PDF", body: "인쇄 창에서 'PDF로 저장'을 고르세요. 배경 그래픽을 켜면 색이 그대로 나와요." },
    { icon: "file", title: "PowerPoint", body: "글자는 고칠 수 있는 텍스트 상자로, 발표자 노트도 함께 들어가요." },
    { icon: "download", title: "HTML 파일", body: "서버 없이 열리는 파일 하나로 저장돼요. P를 누르면 발표 모드." },
    { icon: "play", title: "웹 뷰어 · 발표", body: "주소를 팀원에게 공유하면 바로 볼 수 있어요. 방향키로 넘기고 N으로 노트를 봐요." },
  ];
  return (
    <Step id="export" no={7} title="내보내기와 발표" lead="편집 화면 오른쪽 위 '내보내기'와 '발표' 버튼에서 모두 할 수 있어요.">
      <div className="guide-cards">
        {cards.map((c) => (
          <div key={c.title} className="guide-card">
            <Icon name={c.icon} size={22} />
            <h3>{c.title}</h3>
            <p>{c.body}</p>
          </div>
        ))}
      </div>
    </Step>
  );
}

// ─── 8. 팀 ──────────────────────────────────────────────────

function TeamStep({ onTeam }: { onTeam: () => void }) {
  return (
    <Step
      id="team"
      no={8}
      title="팀과 함께 모으고 함께 고쳐요"
      lead="팀을 만들면 레퍼런스·케이스·문서를 같이 써요. 같은 문서를 여러 명이 동시에 고쳐도 서로의 수정이 합쳐지고, 누가 언제 무엇을 바꿨는지 기록이 남아요."
    >
      <div className="guide-cards">
        <div className="guide-card">
          <Icon name="link" size={22} />
          <h3>메일로 초대</h3>
          <p>받는 사람 메일에만 쓸 수 있는 초대 링크를 보내요. 링크가 새어 나가도 다른 사람은 들어올 수 없어요.</p>
        </div>
        <div className="guide-card">
          <Icon name="lock" size={22} />
          <h3>코드 + 비밀번호로 초대</h3>
          <p>초대 코드와 비밀번호를 따로 알려 주세요. 기간·인원을 정할 수 있고, 비밀번호를 여러 번 틀리면 잠겨요.</p>
        </div>
        <div className="guide-card">
          <Icon name="refresh" size={22} />
          <h3>버전 기록</h3>
          <p>편집 화면의 &lsquo;버전 기록&rsquo;에서 저장 시점별로 미리 보고, 예전 버전으로 되돌릴 수 있어요.</p>
        </div>
      </div>
      <div className="guide-cta">
        <Button icon="settings" onClick={onTeam}>
          팀 설정 열기
        </Button>
      </div>
    </Step>
  );
}
