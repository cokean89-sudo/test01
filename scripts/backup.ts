// 데이터베이스 백업 — 서버가 켜져 있어도 일관된 스냅샷을 만든다.
//   npm run backup                  → data/backups/refboard-YYYYMMDD-HHMMSS.sqlite
//   npm run backup -- /경로/파일.sqlite
// 최근 백업 30개만 남기고 나머지는 지운다 (BACKUP_KEEP 로 조정).

import "../server/env";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { DATA_DIR } from "../server/config";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const source = path.join(DATA_DIR, "refboard.sqlite");
if (!fs.existsSync(source)) {
  console.error(`데이터베이스가 없습니다: ${source}`);
  process.exit(1);
}

const dir = path.join(DATA_DIR, "backups");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const target = path.resolve(process.argv[2] || path.join(dir, `refboard-${stamp}.sqlite`));
if (fs.existsSync(target)) {
  console.error(`이미 있는 파일입니다: ${target}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });

const db = new DatabaseSync(source, { readOnly: true });
db.exec("PRAGMA busy_timeout = 5000");
db.prepare("VACUUM INTO ?").run(target);
db.close();
if (process.platform !== "win32") fs.chmodSync(target, 0o600);
console.log(`백업 완료: ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);

if (!process.argv[2]) {
  const keep = Number(process.env.BACKUP_KEEP) || 30;
  const old = fs
    .readdirSync(dir)
    .filter((f) => /^refboard-\d{8}-\d{6}\.sqlite$/.test(f))
    .sort()
    .reverse()
    .slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  if (old.length) console.log(`오래된 백업 ${old.length}개를 정리했습니다.`);
}
