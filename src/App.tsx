import { useEffect } from "react";
import { Icon } from "./components/icons";
import { Button, Toasts } from "./components/ui";
import { navigate, useRoute } from "./lib/router";
import { useLibrary } from "./store/library";
import { useUI } from "./store/ui";
import { BuildDialog } from "./views/BuildDialog";
import { CasesView } from "./views/CasesView";
import { CollectDialog } from "./views/CollectDialog";
import { DocsView } from "./views/DocsView";
import { EditorView } from "./views/editor/EditorView";
import { LibraryView } from "./views/LibraryView";
import { PrintView } from "./views/PrintView";
import { ViewerView } from "./views/ViewerView";

export function App() {
  const route = useRoute();
  const load = useLibrary((s) => s.load);
  const collect = useUI((s) => s.collect);
  const build = useUI((s) => s.build);

  useEffect(() => {
    load().catch((err) => console.error(err));
  }, [load]);

  const [section = "library", id] = route;

  // 뷰어·인쇄는 앱 크롬 없이 단독 화면
  if (section === "view" && id) return <ViewerView id={id} />;
  if (section === "print" && id) return <PrintView id={id} />;

  return (
    <div className="app">
      <TopBar section={section} />
      <main className="app-main">
        {section === "edit" && id ? (
          <EditorView id={id} />
        ) : section === "cases" ? (
          <CasesView />
        ) : section === "docs" ? (
          <DocsView />
        ) : (
          <LibraryView />
        )}
      </main>
      {collect.open && <CollectDialog initialUrls={collect.urls} />}
      {build.open && <BuildDialog preset={build.preset} />}
      <Toasts />
    </div>
  );
}

function TopBar({ section }: { section: string }) {
  const status = useLibrary((s) => s.status);
  const refCount = useLibrary((s) => s.refs.length);
  const { openCollect, openBuild } = useUI();
  const tabs = [
    { key: "library", label: "레퍼런스", icon: "grid" as const, count: refCount },
    { key: "cases", label: "케이스", icon: "folder" as const },
    { key: "docs", label: "문서", icon: "file" as const },
  ];
  const active = section === "edit" ? "docs" : section;
  return (
    <header className="topbar">
      <a className="brand" href="#/library">
        <span className="brand-mark" />
        RefBoard
      </a>
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
        <span className={"ai-status" + (status?.ai ? " on" : "")} title={status?.ai ? `Claude 연결됨 (${status.model})` : status?.aiReason}>
          <Icon name="sparkle" size={14} />
          {status?.ai ? "AI 연결됨" : "AI 미설정"}
        </span>
        <Button icon="sparkle" onClick={() => openBuild()}>
          키워드로 문서 만들기
        </Button>
        <Button icon="plus" variant="primary" onClick={() => openCollect()}>
          레퍼런스 추가
        </Button>
      </div>
    </header>
  );
}
