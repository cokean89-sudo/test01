// Render 배포 설정(render.yaml) 점검 — 비밀값이 파일에 적히지 않았는지, 서버가 실제로 읽는 변수인지.

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const yaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
const lines = yaml.split("\n").map((l) => l.replace(/\s+#.*$/, "").trimEnd());

/** envVars 목록: key → { value?, sync? } */
function envVars() {
  const out = new Map<string, { value?: string; sync?: string }>();
  let cur: { value?: string; sync?: string } | null = null;
  for (const l of lines) {
    const key = /^\s*- key: (\S+)$/.exec(l);
    if (key) {
      cur = {};
      out.set(key[1], cur);
      continue;
    }
    const prop = /^\s+(value|sync): (.+)$/.exec(l);
    if (prop && cur) cur[prop[1] as "value" | "sync"] = prop[2].replace(/^"|"$/g, "");
  }
  return out;
}

describe("render.yaml", () => {
  const vars = envVars();

  it("Node 런타임 · Starter · 빌드/시작 명령 · 헬스 체크 · 영구 디스크", () => {
    expect(yaml).toMatch(/^\s+runtime: node$/m);
    expect(yaml).toMatch(/^\s+plan: starter$/m);
    expect(yaml).toMatch(/^\s+buildCommand: npm ci && npm run build$/m);
    expect(yaml).toMatch(/^\s+startCommand: npm start$/m);
    expect(yaml).toMatch(/^\s+healthCheckPath: \/api\/health$/m);
    const mount = /^\s+mountPath: (\S+)$/m.exec(yaml)?.[1];
    expect(mount).toBe("/var/data");
    expect(vars.get("DATA_DIR")?.value).toBe(mount);
    expect(vars.get("TRUST_PROXY")?.value).toBe("1");
    expect(Number(vars.get("NODE_VERSION")?.value)).toBeGreaterThanOrEqual(22);
    expect(vars.get("HOST")?.value).toBe("0.0.0.0");
  });

  it("비밀값은 값 없이 sync: false", () => {
    for (const k of ["ANTHROPIC_API_KEY", "SMTP_PASS", "SMTP_USER", "KAKAO_CLIENT_SECRET", "NAVER_CLIENT_SECRET"]) {
      expect(vars.get(k), k).toEqual({ sync: "false" });
    }
    for (const [k, v] of vars) {
      if (/KEY|PASS|SECRET|TOKEN/.test(k)) expect(v.value, k).toBeUndefined();
    }
  });

  it("NODE_ENV 는 넣지 않는다 (npm ci 가 빌드 도구를 빼먹음)", () => {
    expect(vars.has("NODE_ENV")).toBe(false);
  });

  it("모든 변수를 서버가 실제로 읽는다 (오타 방지)", () => {
    const src = fs
      .readdirSync(path.join(root, "server"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => fs.readFileSync(path.join(root, "server", f), "utf8"))
      .join("\n");
    for (const k of vars.keys()) {
      if (k === "NODE_VERSION") continue; // Render 가 읽는 값
      expect(src.includes(`env.${k}`), k).toBe(true);
    }
  });

  it("Node 버전 파일과 package.json engines 가 22 이상", () => {
    expect(fs.readFileSync(path.join(root, ".node-version"), "utf8").trim()).toBe("22");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.engines.node).toMatch(/>=\s*22/);
    expect(pkg.scripts.start).toContain("--prod");
  });
});

describe("APP_URL", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it("비어 있으면 Render 서비스 주소를 쓴다 → https 쿠키 보안이 켜진다", async () => {
    delete process.env.APP_URL;
    process.env.RENDER_EXTERNAL_URL = "https://refboard-abcd.onrender.com/";
    vi.resetModules();
    const cfg = await import("../server/config");
    expect(cfg.APP_URL).toBe("https://refboard-abcd.onrender.com");
    expect(cfg.SECURE_COOKIES).toBe(true);
    expect(cfg.LOCAL_ONLY).toBe(false);
  });

  it("직접 지정한 APP_URL 이 우선", async () => {
    process.env.APP_URL = "https://ref.example.com";
    process.env.RENDER_EXTERNAL_URL = "https://refboard-abcd.onrender.com";
    vi.resetModules();
    const cfg = await import("../server/config");
    expect(cfg.APP_URL).toBe("https://ref.example.com");
  });
});
