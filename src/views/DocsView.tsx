import { useEffect, useState } from "react";
import { ROLE_RANK, type DocSettings, type DocumentSummary } from "../../shared/types";
import { api } from "../api";
import { SmartImage } from "../components/SmartImage";
import { Icon } from "../components/icons";
import { Button, Empty, Field, Menu, MenuItem, Modal, Segmented } from "../components/ui";
import { fontsNote, settingsWithTemplate, TemplatePicker, type TemplateChoice } from "../components/TemplatePicker";
import { createStarterPages } from "../layout/templates";
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

  const [creating, setCreating] = useState(false);
  return (
    <div className="docs">
      <div className="docs-head">
        <h2>문서</h2>
        <span className="muted small">{team?.name}</span>
        <span className="spacer" />
        {canEdit && (
          <>
            <Button variant="primary" icon="sparkle" onClick={() => openBuild()}>
              키워드로 문서 만들기
            </Button>
          </>
        )}
      </div>
      {docs && docs.length === 0 && (
        <Empty emoji="📄" title="아직 만든 문서가 없어요">
          <p>키워드만 넣으면 태그·케이스별로 묶어서 보고서 페이지를 자동으로 만들어 줘요.</p>
          {canEdit && (
            <div className="row">
              <Button size="lg" variant="primary" icon="sparkle" onClick={() => openBuild()}>
                키워드로 문서 만들기
              </Button>
              <Button size="lg" icon="plus" onClick={() => setCreating(true)}>
                템플릿으로 시작
              </Button>
            </div>
          )}
        </Empty>
      )}
      <div className="doc-grid">
        {canEdit && !!docs?.length && (
          <button className="doc-new" onClick={() => setCreating(true)}>
            <span className="plus">
              <Icon name="plus" size={22} />
            </span>
            새 문서
            <span className="muted small">템플릿을 골라 페이지 세트로 시작해요</span>
          </button>
        )}
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
                    <MenuItem icon="eye" onClick={() => (close(), window.open("#/view/" + d.id, "_blank"))}>
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
      {creating && teamId && <NewDocDialog teamId={teamId} onClose={() => setCreating(false)} />}
    </div>
  );
}

/** 새 문서 — 템플릿(썸네일)과 시작 페이지 구성을 고른다 */
function NewDocDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [base, setBase] = useState<DocSettings | null>(null);
  const [choice, setChoice] = useState<TemplateChoice>({ id: "default" });
  const [set, setSet] = useState<"full" | "basic">("full");
  const [title, setTitle] = useState("Untitled");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // 팀 기본 설정(부서명·양식·템플릿)으로 시작
    loadTeamDefaults(teamId)
      .then((s) => {
        setBase(s);
        setChoice({ id: s.template ?? "default", accent: s.template === "tonal" ? s.accent : undefined });
      })
      .catch((err) => toast.error((err as Error).message));
  }, [teamId]);

  async function create() {
    if (!base) return;
    setBusy(true);
    try {
      const settings = settingsWithTemplate(base, choice);
      const doc = await api.createDocument({ title: title.trim() || "Untitled", settings, pages: createStarterPages(settings, set) });
      navigate("edit/" + doc.id);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="새 문서 — 템플릿 고르기"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="muted small">폰트: {fontsNote(choice.id)} (모두 상업적 사용 무료 · OFL)</span>
          <span className="spacer" />
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" onClick={create} disabled={!base || busy}>
            {busy ? "만드는 중…" : "이 템플릿으로 만들기"}
          </Button>
        </>
      }
    >
      <div className="new-doc">
        <div className="new-doc-opts">
          <Field label="문서 제목">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <div className="field">
            <span className="field-label">시작 페이지</span>
            <Segmented<"full" | "basic">
              value={set}
              onChange={setSet}
              options={[
                { value: "full", label: "페이지 세트 7장", title: "표지 · 목차 · 간지 · 케이스 스터디 · 레퍼런스 · 비교 · 마무리" },
                { value: "basic", label: "표지 + 레퍼런스", title: "표지와 레퍼런스 페이지 1장" },
              ]}
            />
            <span className="field-hint">{set === "full" ? "표지 · 목차 · 섹션 구분 · 케이스 스터디 · 레퍼런스 그리드 · 경쟁사·상품 비교 · 마무리" : "표지와 레퍼런스 페이지 1장"}</span>
          </div>
          <p className="help-text">템플릿은 작성 중에도 편집기 오른쪽 &lsquo;문서 양식 → 템플릿&rsquo;에서 바꿀 수 있어요. 글과 이미지는 그대로 옮겨져요.</p>
        </div>
        {base ? <TemplatePicker value={choice} onChange={setChoice} pageSize={base.pageSize} /> : <p className="muted">불러오는 중…</p>}
      </div>
    </Modal>
  );
}