import { useEffect, type ReactNode } from "react";
import { ROLE_LABEL, ROLE_RANK } from "../shared/types";
import { TeamAvatar, UserAvatar } from "./components/Avatar";
import { Icon } from "./components/icons";
import { UpdatesDialog, VersionLink } from "./components/Updates";
import { Button, Menu, MenuItem, Spinner, Toasts } from "./components/ui";
import { navigate, useRoute } from "./lib/router";
import { takeShared } from "./lib/share";
import { useLibrary } from "./store/library";
import { connectTeamEvents, useCurrentTeam, useSession } from "./store/session";
import { toast } from "./store/toast";
import { useUI } from "./store/ui";
import { useUpdates } from "./store/updates";
import { AdminFeedbackView } from "./views/AdminFeedbackView";
import { AdminUsageView } from "./views/AdminUsageView";
import { AccountView, ForgotView, InviteView, LoginView, ResetView, SignupView, VerifyView } from "./views/auth/AuthViews";
import { BuildDialog } from "./views/BuildDialog";
import { CasesView } from "./views/CasesView";
import { CollectDialog, extractUrls } from "./views/CollectDialog";
import { DocsView } from "./views/DocsView";
import { EditorView } from "./views/editor/EditorView";
import { FeedbackDialog } from "./views/FeedbackDialog";
import { GuideView } from "./views/GuideView";
import { LibraryView } from "./views/LibraryView";
import { PrintView } from "./views/PrintView";
import { TagsView } from "./views/TagsView";
import { TeamView } from "./views/team/TeamView";
import { ViewerView } from "./views/ViewerView";

const PUBLIC = new Set(["login", "signup", "forgot", "verify", "reset", "invite", "guide"]);

export function App() {
  const route = useRoute();
  const status = useSession((s) => s.status);
  const teamId = useSession((s) => s.teamId);
  const init = useSession((s) => s.init);
  const collect = useUI((s) => s.collect);
  const build = useUI((s) => s.build);
  const feedback = useUI((s) => s.feedback);
  const setFeedback = useUI((s) => s.setFeedback);
  const updatesOpen = useUpdates((s) => s.open);
  const userId = useSession((s) => s.user?.id);
  const signedUpAt = useSession((s) => s.user?.createdAt);
  const [section = "library", id] = route;

  // 업데이트 소식: 사용자마다 본 기록이 따로
  useEffect(() => {
    useUpdates.getState().init(userId ? { id: userId, createdAt: signedUpAt } : null);
  }, [userId, signedUpAt]);

  useEffect(() => {
    init().catch((err) => toast.error("서버에 연결할 수 없어요: " + (err as Error).message));
  }, [init]);

  // 소셜 로그인은 첫 화면(#/)으로 돌아오므로, 로그인 전에 보던 페이지가 있으면 그리로 보낸다
  useEffect(() => {
    if (status !== "ready") return;
    const after = sessionStorage.getItem("rb.after");
    if (!after) return;
    sessionStorage.removeItem("rb.after");
    if (after.startsWith("#/") && ["", "#", "#/", "#/library", "#/login"].includes(location.hash)) location.hash = after;
  }, [status]);

  // 휴대폰 공유 메뉴로 받은 이미지 · 링크 → 레퍼런스 추가 창 (로그인 전이면 로그인 뒤에 여기로 돌아온다)
  useEffect(() => {
    if (status !== "ready" || section !== "share" || !id) return;
    navigate("library");
    if (id === "nosw" || id === "failed") {
      toast.error("공유한 내용을 받지 못했어요. RefBoard 를 한 번 연 뒤 다시 공유해 주세요.");
      return;
    }
    void takeShared(id).then((shared) => {
      if (!shared || (!shared.files.length && !extractUrls(shared.text).length)) {
        toast.error(shared ? "공유한 내용에 이미지나 링크가 없어요." : "공유한 내용을 찾지 못했어요. 다시 공유해 주세요.");
        return;
      }
      const team = useSession.getState().teams.find((t) => t.id === useSession.getState().teamId);
      if (!team || ROLE_RANK[team.role] < ROLE_RANK.editor) {
        toast.error("이 팀에서는 레퍼런스를 추가할 수 없어요 (보기 전용). 팀을 바꾼 뒤 다시 공유해 주세요.");
        return;
      }
      useUI.getState().openCollect(extractUrls(shared.text).length ? shared.text : undefined, shared.files);
    });
  }, [status, section, id]);

  // 팀이 바뀌면 라이브러리를 새로 불러오고, 팀 실시간 이벤트를 구독한다
  useEffect(() => {
    if (status !== "ready" || !teamId) return;
    const lib = useLibrary.getState();
    lib.reset();
    lib.load().catch((err) => console.error(err));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reloadLibrary = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => useLibrary.getState().load().catch(() => undefined), 300);
    };
    const s = useSession.getState();
    return connectTeamEvents(teamId, {
      library: reloadLibrary,
      team: () => {
        s.bump("team");
        void s.refreshTeams();
      },
      docs: () => s.bump("docs"),
      doc: () => s.bump("docs"),
      removed: () => {
        toast.error("이 팀에서 내보내졌거나 팀이 삭제됐어요");
        void s.refreshTeams().then(() => navigate("library"));
      },
    });
  }, [status, teamId]);

  if (status === "loading") {
    return (
      <div className="center-msg">
        <Spinner size={22} />
      </div>
    );
  }

  // 로그인 전: 공개 화면만
  if (status === "anonymous") {
    if (section === "guide") return <Shell><PublicGuide section={id} /></Shell>;
    if (section === "signup") return <Shell><SignupView /></Shell>;
    if (section === "forgot") return <Shell><ForgotView /></Shell>;
    if (section === "verify" && id) return <Shell><VerifyView token={id} /></Shell>;
    if (section === "reset" && id) return <Shell><ResetView token={id} /></Shell>;
    if (section === "invite" && id) return <Shell><InviteView token={id} /></Shell>;
    if (!PUBLIC.has(section) && location.hash.length > 2) sessionStorage.setItem("rb.after", location.hash);
    return <Shell><LoginView /></Shell>;
  }

  if (section === "verify" && id) return <Shell><VerifyView token={id} /></Shell>;
  if (section === "reset" && id) return <Shell><ResetView token={id} /></Shell>;
  if (section === "invite" && id) return <Shell><InviteView token={id} /></Shell>;
  if (section === "login" || section === "signup") {
    navigate("library");
    return null;
  }

  // 뷰어·인쇄는 앱 크롬 없이 단독 화면
  if (section === "view" && id) return <ViewerView id={id} />;
  if (section === "print" && id) return <PrintView id={id} />;

  return (
    <div className={"app" + (section === "edit" ? " no-nav" : "")}>
      <TopBar section={section} />
      <main className="app-main">
        {section === "edit" && id ? (
          <EditorView id={id} />
        ) : section === "cases" ? (
          <CasesView />
        ) : section === "docs" ? (
          <DocsView />
        ) : section === "team" ? (
          <TeamView />
        ) : section === "account" ? (
          <AccountView />
        ) : section === "guide" ? (
          <GuideView section={id} />
        ) : section === "tags" ? (
          <TagsView />
        ) : section === "admin" && id === "usage" ? (
          <AdminUsageView />
        ) : section === "admin" ? (
          <AdminFeedbackView id={route[2]} />
        ) : (
          <LibraryView />
        )}
      </main>
      {section !== "edit" && <MobileNav section={section} />}
      {collect.open && <CollectDialog initialUrls={collect.urls} initialFiles={collect.files} />}
      {build.open && <BuildDialog preset={build.preset} />}
      {section !== "edit" && (
        <button className="feedback-fab" onClick={() => setFeedback(true)} title="오류 신고 · 개선 요청">
          <Icon name="message" size={17} />
          의견 보내기
        </button>
      )}
      {feedback && <FeedbackDialog />}
      {updatesOpen && <UpdatesDialog />}
      <Toasts />
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toasts />
    </>
  );
}

/** 로그인 전에도 볼 수 있는 가이드 — 간단한 상단 막대만 */
function PublicGuide({ section }: { section?: string }) {
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/login">
          <span className="brand-mark" />
          RefBoard
        </a>
        <div className="topbar-right">
          <Button variant="primary" onClick={() => navigate("login")}>
            로그인하고 시작하기
          </Button>
        </div>
      </header>
      <main className="app-main">
        <GuideView section={section} />
      </main>
    </div>
  );
}

function TopBar({ section }: { section: string }) {
  const status = useLibrary((s) => s.status);
  const refCount = useLibrary((s) => s.refs.length);
  const { user, teams, switchTeam, logout } = useSession();
  const team = useCurrentTeam();
  const { openCollect, openBuild, setFeedback } = useUI();
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const tabs = [
    { key: "library", label: "레퍼런스", icon: "grid" as const, count: refCount },
    { key: "cases", label: "케이스", icon: "folder" as const },
    { key: "docs", label: "문서", icon: "file" as const },
    { key: "team", label: "팀", icon: "layers" as const },
  ];
  const active = section === "edit" ? "docs" : section === "tags" ? "library" : section;
  return (
    <header className="topbar">
      <a
        className="brand"
        href="#/library"
        title="첫 화면으로 (검색 · 태그 초기화)"
        onClick={(e) => {
          // 로고 = 첫 화면: 태그 · 검색 조건을 모두 풀고 전체 이미지
          e.preventDefault();
          useUI.getState().resetLibrary();
          navigate("library");
        }}
      >
        <span className="brand-mark" />
        RefBoard
      </a>
      <Menu
        trigger={(open) => (
          <button className="team-switch" onClick={open} title="팀 전환">
            {team ? <TeamAvatar profile={team.profile} name={team.name} size="xs" /> : <span className="team-dot" />}
            <span className="team-name ellipsis">{team?.name ?? "팀 없음"}</span>
            <Icon name="down" size={13} />
          </button>
        )}
      >
        {(close) => (
          <>
            {teams.map((t) => (
              <MenuItem
                key={t.id}
                lead={<TeamAvatar profile={t.profile} name={t.name} size="xs" />}
                hint={`${ROLE_LABEL[t.role]} · ${t.memberCount}명`}
                onClick={() => {
                  close();
                  switchTeam(t.id);
                  if (section === "edit") navigate("docs");
                }}
              >
                <span className={"team-menu-name" + (t.id === team?.id ? " on" : "")}>
                  {t.name}
                  {t.id === team?.id && <Icon name="check" size={14} aria-label="지금 팀" />}
                </span>
              </MenuItem>
            ))}
            <div className="menu-sep" />
            <MenuItem icon="settings" onClick={() => (close(), navigate("team"))}>
              팀 관리 · 초대
            </MenuItem>
          </>
        )}
      </Menu>
      <nav className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={"tab" + (active === t.key ? " on" : "")} onClick={() => navigate(t.key)}>
            <Icon name={t.icon} size={15} />
            {t.label}
            {t.count ? <span className="count">{t.count}</span> : null}
          </button>
        ))}
      </nav>
      <div className="topbar-right">
        <a className="tip-btn" href="#/guide" title="사용 가이드 — 핀터레스트 링크 복사부터 문서 만들기까지">
          <Icon name="bulb" size={16} />
          TIP
        </a>
        <span
          className={"ai-status" + (status?.ai ? " on" : status?.aiPaused ? " paused" : "")}
          title={status?.ai ? `Claude 연결됨 (${status.model})` : status?.aiReason}
        >
          <Icon name="sparkle" size={14} />
          {status?.ai ? "AI 켜짐" : status?.aiPaused ? "AI 쉬는 중" : "AI 꺼짐"}
        </span>
        {canEdit && (
          <>
            <Button icon="sparkle" variant="accent" onClick={() => openBuild()}>
              문서 만들기
            </Button>
            <Button icon="plus" variant="primary" onClick={() => openCollect()}>
              레퍼런스 추가
            </Button>
          </>
        )}
        <Menu
          align="right"
          trigger={(open) => (
            <button className="avatar-btn" onClick={open} title={user?.email ?? user?.name} aria-label="내 계정 메뉴">
              <UserAvatar profile={user?.profile} name={user?.name} size="md" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-head">
                <UserAvatar profile={user?.profile} name={user?.name} size="lg" />
                <div className="menu-head-text">
                  <strong>{user?.name}</strong>
                  <span className="muted small">{user?.email ?? "소셜 로그인"}</span>
                </div>
              </div>
              <MenuItem icon="settings" onClick={() => (close(), navigate("account"))}>
                내 계정
              </MenuItem>
              <MenuItem icon="message" onClick={() => (close(), setFeedback(true))}>
                의견 보내기
              </MenuItem>
              {user?.isAdmin && (
                <>
                  <MenuItem icon="file" onClick={() => (close(), navigate("admin/feedback"))}>
                    받은 의견 (관리자)
                  </MenuItem>
                  <MenuItem icon="layers" onClick={() => (close(), navigate("admin/usage"))}>
                    사용량 (관리자)
                  </MenuItem>
                </>
              )}
              <MenuItem icon="x" onClick={() => (close(), void logout())}>
                로그아웃
              </MenuItem>
              <div className="menu-sep" />
              <VersionLink onOpen={close} />
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

/** 휴대폰 하단 탭 — 레퍼런스 · 케이스 · ＋추가 · 문서 · 팀 (PC 에서는 숨김, 위쪽 탭을 쓴다) */
function MobileNav({ section }: { section: string }) {
  const team = useCurrentTeam();
  const openCollect = useUI((s) => s.openCollect);
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const active = section === "tags" ? "library" : section;
  const item = (key: string, label: string, icon: "grid" | "folder" | "file" | "layers") => (
    <button key={key} className={"mobile-nav-item" + (active === key ? " on" : "")} onClick={() => (key === "library" && active === "library" ? useUI.getState().resetLibrary() : navigate(key))} aria-current={active === key ? "page" : undefined}>
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="mobile-nav" aria-label="메뉴">
      {item("library", "레퍼런스", "grid")}
      {item("cases", "케이스", "folder")}
      {canEdit && (
        <button className="mobile-nav-add" onClick={() => openCollect()} aria-label="레퍼런스 추가">
          <Icon name="plus" size={22} />
        </button>
      )}
      {item("docs", "문서", "file")}
      {item("team", "팀", "layers")}
    </nav>
  );
}
