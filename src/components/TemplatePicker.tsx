// 문서 템플릿 고르기 — 템플릿마다 샘플 사례로 실제 페이지(표지 + 내용)를 그려 썸네일로 보여준다.

import { memo, useMemo } from "react";
import type { DocSettings, Reference, TemplateId } from "../../shared/types";
import { createCoverPage, createReferencePage } from "../layout/templates";
import { applyThemeSettings, THEMES } from "../layout/themes";
import { defaultSettings } from "../lib/defaults";
import { sampleCase, sampleImage } from "../lib/dummy";
import { Icon } from "./icons";
import { PageView } from "./PageView";

export interface TemplateChoice {
  id: TemplateId;
  /** 톤온톤 메인 컬러 (다른 템플릿은 템플릿 기본 강조색) */
  accent?: string;
}

function sampleRef(key: string): Reference {
  const i = sampleImage(key);
  return { id: "sample-" + key, imageUrl: i.src, title: i.title, tags: i.tags, kind: "image", width: i.w, height: i.h, source: "manual", createdAt: 0 };
}

/** 템플릿 썸네일 — 표지와 레퍼런스 페이지 */
export const TemplateThumbs = memo(function TemplateThumbs({ id, accent, pageSize, pages = 2 }: { id: TemplateId; accent?: string; pageSize?: DocSettings["pageSize"]; pages?: 1 | 2 }) {
  const { settings, list } = useMemo(() => {
    const s = applyThemeSettings({ ...defaultSettings(), pageSize: pageSize ?? "a4-landscape" }, id, accent);
    s.footer.left = "BRAND STRATEGY TEAM";
    const brand = sampleCase("brand");
    const cover = createCoverPage(s, { images: [sampleRef("brand-popup")] });
    const ref = createReferencePage(s, {
      title: "Pop-up Store",
      subtitle: "Brand\nSpace Reference",
      description: "브랜드 컬러를 외관 · 쇼윈도 · 포스터까지 이어서 적용한 팝업스토어 사례",
      images: [...brand.images.map((i) => sampleRef(i.key)), sampleRef("product-lineup")],
    });
    return { settings: s, list: pages === 1 ? [cover] : [cover, ref] };
  }, [id, accent, pageSize, pages]);
  return (
    <div className="tpl-thumbs">
      {list.map((p, i) => (
        <div key={p.id} className="tpl-thumb">
          <PageView page={p} settings={settings} index={i} total={list.length} mode="thumb" docTitle="Brand Case Study" />
        </div>
      ))}
    </div>
  );
});

/** 톤온톤 메인 컬러 고르기 */
export function MainColorPicker({ value, onChange, swatches }: { value: string; onChange: (c: string) => void; swatches: string[] }) {
  return (
    <div className="swatch-row" role="radiogroup" aria-label="메인 컬러">
      {swatches.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value.toLowerCase() === c} className={"swatch" + (value.toLowerCase() === c ? " on" : "")} style={{ background: c }} onClick={() => onChange(c)} title={c} />
      ))}
      <label className="swatch swatch-custom" title="직접 고르기">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#2f6b5b"} onChange={(e) => onChange(e.target.value)} />
        <Icon name="plus" size={12} />
      </label>
    </div>
  );
}

/** 템플릿 목록 — 썸네일 카드 */
export function TemplatePicker({ value, onChange, compact, pageSize }: { value: TemplateChoice; onChange: (v: TemplateChoice) => void; compact?: boolean; pageSize?: DocSettings["pageSize"] }) {
  return (
    <div className={"tpl-grid" + (compact ? " compact" : "")} role="radiogroup" aria-label="문서 템플릿">
      {THEMES.map((t) => {
        const on = value.id === t.id;
        const accent = t.id === "tonal" && on ? value.accent ?? t.accent : undefined;
        return (
          <div key={t.id} className={"tpl-card" + (on ? " on" : "")}>
            <button type="button" role="radio" aria-checked={on} className="tpl-pick" onClick={() => onChange({ id: t.id, accent: t.id === "tonal" ? value.accent && value.id === "tonal" ? value.accent : t.accent : undefined })}>
              <TemplateThumbs id={t.id} accent={accent} pageSize={pageSize} pages={compact ? 1 : 2} />
              <span className="tpl-name">
                {on && <Icon name="check" size={14} />}
                {t.name}
              </span>
              {!compact && <span className="tpl-desc">{t.description}</span>}
            </button>
            {on && t.swatches && (
              <div className="tpl-colors">
                <span className="muted small">메인 컬러</span>
                <MainColorPicker value={value.accent ?? t.accent} swatches={t.swatches} onChange={(c) => onChange({ id: t.id, accent: c })} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 선택한 템플릿을 문서 설정에 적용 (같은 템플릿·색이면 그대로) */
export function settingsWithTemplate(base: DocSettings, choice: TemplateChoice): DocSettings {
  const same = (base.template ?? "default") === choice.id && (!choice.accent || choice.accent === base.accent);
  return same ? structuredClone(base) : applyThemeSettings(base, choice.id, choice.accent);
}

export function fontsNote(id: TemplateId): string {
  return THEMES.find((t) => t.id === id)?.fonts.join(" · ") ?? "";
}
