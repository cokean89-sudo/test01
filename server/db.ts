// JSON 파일 저장소 — 이미지는 저장하지 않고 URL/메타데이터만 보관한다.

import fs from "node:fs";
import path from "node:path";
import type { CaseStudy, DocumentData, Reference } from "../shared/types";

export interface DbShape {
  version: 1;
  references: Reference[];
  cases: CaseStudy[];
  documents: DocumentData[];
}

const empty = (): DbShape => ({ version: 1, references: [], cases: [], documents: [] });

export class JsonDb {
  data: DbShape;
  private file: string;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, "db.json");
    this.data = this.load();
  }

  private load(): DbShape {
    if (!fs.existsSync(this.file)) return empty();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as Partial<DbShape>;
      return { ...empty(), ...parsed, version: 1 };
    } catch (err) {
      const backup = this.file + ".broken-" + Date.now();
      fs.copyFileSync(this.file, backup);
      console.error(`[db] db.json 을 읽지 못해 ${backup} 로 백업하고 새로 시작합니다:`, err);
      return empty();
    }
  }

  /** 변경 후 호출 — 짧게 모아서 원자적으로 기록 */
  save(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  replace(next: DbShape): void {
    this.data = { ...empty(), ...next, version: 1 };
    this.save();
  }
}
