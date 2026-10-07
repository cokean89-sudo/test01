// 프로필 이미지 — 앱 어디서든(상단 계정 메뉴 · 팀 전환 · 팀원 목록 · 접속자 표시 · 활동 기록 · 이후 코멘트) 이 컴포넌트로 보여 준다.
//   UserAvatar  올린 사진, 없으면 Fluent Emoji 3D + 연한 배경색. ring 을 주면 사용자 고유 색 테두리 (공동 작업 표시용)
//   TeamAvatar  올린 사진, 없으면 팀 색 + 팀 이름 첫 글자

import { useState, type CSSProperties } from "react";
import {
  EMOJI_CATEGORIES,
  emojiLabel,
  emojiUrl,
  initialOf,
  PROFILE_COLORS,
  profileColorVar,
  profileSoftVar,
  type ProfileColor,
  type TeamProfile,
  type UserProfile,
} from "../../shared/profile";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export function UserAvatar({
  profile,
  name,
  size = "md",
  ring,
  className,
  title,
}: {
  profile?: UserProfile | null;
  name?: string;
  size?: AvatarSize;
  /** 사용자 고유 색 테두리 (접속자 표시 · 이후 선택 테두리 · 깃발) */
  ring?: boolean;
  className?: string;
  title?: string;
}) {
  const style: CSSProperties = {};
  if (ring && profile) style.borderColor = profileColorVar(profile.color);
  const cls = `avatar-face avatar-${size}${ring ? " ring" : ""}${className ? " " + className : ""}`;
  if (profile?.image) {
    return (
      <span className={cls + " photo"} style={style} title={title} data-avatar="photo">
        <img src={profile.image} alt={name ? `${name} 프로필 사진` : ""} draggable={false} />
      </span>
    );
  }
  if (!profile) {
    return (
      <span className={cls + " letter"} style={style} title={title}>
        {initialOf(name ?? "")}
      </span>
    );
  }
  style.background = profileSoftVar(profile.bg);
  return (
    <span className={cls + " emoji"} style={style} title={title} data-avatar="emoji" data-emoji={profile.emoji}>
      <img src={emojiUrl(profile.emoji)} alt={name ? `${name} — ${emojiLabel(profile.emoji)}` : ""} draggable={false} />
    </span>
  );
}

export function TeamAvatar({ profile, name, size = "md", className, title }: { profile?: TeamProfile | null; name: string; size?: AvatarSize; className?: string; title?: string }) {
  const cls = `avatar-face team avatar-${size}${className ? " " + className : ""}`;
  if (profile?.image) {
    return (
      <span className={cls + " photo"} title={title} data-avatar="photo">
        <img src={profile.image} alt={`${name} 팀 사진`} draggable={false} />
      </span>
    );
  }
  return (
    <span className={cls + " letter"} style={{ background: profileColorVar(profile?.color ?? "blue") }} title={title} data-avatar="letter" aria-hidden="true">
      {initialOf(name)}
    </span>
  );
}

/** 팔레트 — 12색 중 하나. tone=soft 는 이모지 배경, solid 는 팀 색 · 내 색 */
export function ColorPalette({
  value,
  onChange,
  tone = "solid",
  label,
  disabled,
}: {
  value: ProfileColor;
  onChange: (c: ProfileColor) => void;
  tone?: "solid" | "soft";
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="palette" role="radiogroup" aria-label={label}>
      {PROFILE_COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={value === c.key}
          aria-label={c.label}
          title={c.label}
          disabled={disabled}
          className={"swatch" + (value === c.key ? " on" : "")}
          style={{ background: tone === "soft" ? profileSoftVar(c.key) : profileColorVar(c.key) }}
          onClick={() => value !== c.key && onChange(c.key)}
        />
      ))}
    </div>
  );
}

/** 기본 이모지 고르기 — 카테고리 탭 + 그림 목록 */
export function EmojiPicker({ value, bg, onChange, disabled }: { value: string; bg: ProfileColor; onChange: (id: string) => void; disabled?: boolean }) {
  const [cat, setCat] = useState(() => EMOJI_CATEGORIES.find((c) => c.items.some((e) => e.id === value))?.key ?? EMOJI_CATEGORIES[0].key);
  const current = EMOJI_CATEGORIES.find((c) => c.key === cat) ?? EMOJI_CATEGORIES[0];
  return (
    <div className="emoji-picker">
      <div className="emoji-tabs" role="tablist" aria-label="이모지 종류">
        {EMOJI_CATEGORIES.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={c.key === cat} className={c.key === cat ? "on" : ""} onClick={() => setCat(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="emoji-grid" role="radiogroup" aria-label={`${current.label} 이모지`}>
        {current.items.map((e) => (
          <button
            key={e.id}
            type="button"
            role="radio"
            aria-checked={value === e.id}
            aria-label={e.label}
            title={e.label}
            disabled={disabled}
            className={"emoji-cell" + (value === e.id ? " on" : "")}
            style={value === e.id ? { background: profileSoftVar(bg) } : undefined}
            onClick={() => value !== e.id && onChange(e.id)}
          >
            <img src={emojiUrl(e.id)} alt="" loading="lazy" draggable={false} />
          </button>
        ))}
      </div>
    </div>
  );
}
