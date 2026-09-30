// 올린 이미지를 다른 저장소로 옮기기 — 디스크(DATA_DIR/uploads) → Cloudflare R2 · AWS S3
//
//   1) Render → Environment 에 STORAGE_DRIVER=s3 와 S3_* 값을 넣기 전에(또는 넣은 뒤 Shell 에서)
//   2) STORAGE_DRIVER=s3 S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… S3_ENDPOINT=… npm run storage:migrate
//   3) 끝나면 STORAGE_DRIVER=s3 로 재배포 — 앱 안의 이미지 주소(/api/files/…)는 그대로라 문서 · 레퍼런스를 고칠 필요 없음
//
// 원본(디스크) 파일은 지우지 않는다. 새 저장소에서 잘 보이는지 확인한 뒤 직접 지우세요.
//   --dry-run  옮길 파일 수만 확인

import "../server/env";
import path from "node:path";
import { DATA_DIR } from "../server/config";
import { openDatabase } from "../server/db";
import { Repo } from "../server/repo";
import { createStore, DiskStore } from "../server/storage";

const dry = process.argv.includes("--dry-run");
const target = createStore(process.env, DATA_DIR);
const source = new DiskStore(path.resolve(process.env.MIGRATE_FROM_DIR || process.env.UPLOADS_DIR || path.join(DATA_DIR, "uploads")));
if (target.kind === "disk") {
  console.error("옮길 대상이 디스크예요. STORAGE_DRIVER=s3 와 S3_* 값을 지정해서 실행하세요.");
  process.exit(1);
}

const repo = new Repo(openDatabase());
const keys = repo.allFileKeys();
console.log(`${source.where} → ${target.where} · 파일 ${keys.length}개${dry ? " (확인만)" : ""}`);
if (dry) process.exit(0);

let copied = 0;
const missing: string[] = [];
for (const key of keys) {
  const obj = await source.get(key);
  if (!obj) {
    missing.push(key);
    continue;
  }
  await target.put(key, obj.data, obj.contentType);
  copied++;
  if (copied % 100 === 0) console.log(`  ${copied}/${keys.length}`);
}
console.log(`완료: ${copied}개 복사${missing.length ? ` · 디스크에 없는 파일 ${missing.length}개 (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""})` : ""}`);
