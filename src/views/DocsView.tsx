import { useEffect, useState } from "react";
import { ROLE_RANK, type DocumentSummary } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Button, Empty, Menu, MenuItem } from "../components/ui";
import { createReferencePage } from "../layout/templates";
import { navigate } from "../lib/router";
import { useCurrentTeam, useSession } from "../store/session";
import { loadTeamDefaults } from "../store/teamDefaults";
import { toast } from "../store/toast";
import { useUI } from "../store/ui";

export function DocsView() {
  const [docs, setDocs] = useState<DocumentSummary[] | null>(null);
  const openBuild = useUI((s) => s.openBuild);
  const teamId = useSession((s) => s.teamId);
  const tick = useSession((s) => s.ticks.docs);
  const team = useCurrentTeam();
  const canEdit = !!team && ROLE_RANK[team.role] >= ROLE_RANK.editor;
  const reload = () => api.documents().then(setDocs).catch((err) => toast.error(err.message));
  useEffect(() => {
    void reload();
  }, [teamId, tick]);

  async function createBlank() {
    try {
      // 팀 기본 설정(부서명·양식)으로 시작하고, 첫 페이지는 더미 텍스트·회색 박스 템플릿
      const settings = await loadTeamDefaults(teamId);
      const doc = await api.createDocument({ title: "Untitled", settings, pages: [createReferencePage(settings, { title: "", images: [], placeholders: 6 })] });
      navigate("edit/" + doc.id);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="docs">
      <div className="docs-head">
        <h2>문서</h2>
        <span className="muted small">{team?.name}</span>
        <span className="spacer" />
        {canEdit && (
          <>
            <Button onClick={createBlank} icon="plus">
              새 문서
            </Button>
            <Button variant="primary" icon="sparkle" onClick={() => openBuild()}>
              키워드로 자동 생성
            </Button>
          </>
        )}
      </div>
      {docs && docs.length === 0 && (
        <Empty title="아직 문서가 없습니다">
          <p className="muted">키워드를 넣으면 태그·케이스별로 그룹핑해 페이지와 레이아웃을 자동으로 만들어 줍니다.</p>
          <Button variant="primary" icon="sparkle" onClick={() => openBuild()}>
            키워드로 자동 생성
          </Button>
        </Empty>
      )}
      <div className="doc-grid">
        {docs?.map((d) => (
          <article key={d.id} className="doc-card">
            <button className="doc-cover" onClick={() => navigate("edit/" + d.id)}>
              {d.cover ? <SmartImage src={d.cover} /> : <div className="doc-cover-empty" />}
            </button>
            <div className="doc-meta">
              <div>
                <strong className="ellipsis">{d.title}</strong>
                <span className="muted small">
                  {d.pageCount}페이지 · {d.updatedByName ? `${d.updatedByName} · ` : ""}
                  {new Date(d.updatedAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
                </span>
              </div>
              <Menu
                align="right"
                trigger={(open) => <Button icon="dots" variant="ghost" size="sm" onClick={open} aria-label="문서 메뉴" />}
              >
                {(close) => (
                  <>
                    <MenuItem icon="file" onClick={() => navigate("edit/" + d.id)}>
                      {canEdit ? "편집" : "열기"}
                    </MenuItem>
                    <MenuItem icon="eye" onClick={() => window.open("#/view/" + d.id, "_blank")}>
                      웹 뷰어로 보기
                    </MenuItem>
                    {canEdit && (
                      <>
                        <MenuItem
                          icon="copy"
                          onClick={async () => {
                            close();
                            await api.duplicateDocument(d.id);
                            await reload();
                          }}
                        >
                          복제
                        </MenuItem>
                        <MenuItem
                          icon="trash"
                          onClick={async () => {
                            close();
                            if (!confirm(`'${d.title}' 문서를 삭제할까요?`)) return;
                            await api.deleteDocument(d.id);
                            await reload();
                          }}
                        >
                          삭제
                        </MenuItem>
                      </>
                    )}
                  </>
                )}
              </Menu>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
