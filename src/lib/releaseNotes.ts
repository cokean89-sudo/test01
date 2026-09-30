// 업데이트 소식(고객용) — 저장소 루트의 RELEASE_NOTES.md 만 읽어 앱에 보여 준다.
// CHANGELOG.md 는 개발 기록이라 앱에 보이지 않는다. 형식은 같다 (## 버전 — 날짜 / ### 제목 / - 설명).

import raw from "../../RELEASE_NOTES.md?raw";
import { parseChangelog, type ChangelogEntry } from "./changelog";

export type ReleaseNote = ChangelogEntry;

/** 최신이 맨 앞 */
export const RELEASE_NOTES: ReleaseNote[] = parseChangelog(raw);

/** 버그 수정만 있는 버전을 묶는 한 줄 */
export const STABILITY_NOTE = "사용성과 안정성을 개선했어요";
