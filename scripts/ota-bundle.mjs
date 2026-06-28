#!/usr/bin/env node
/**
 * OTA 업데이트용 zip 번들을 생성합니다.
 * 1) npm run build 가 먼저 실행되어 dist/ 가 존재해야 합니다.
 * 2) 결과물: releases/safenex-<version>.zip
 *
 * 사용: node scripts/ota-bundle.mjs [version]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, "dist");
if (!existsSync(dist)) {
  console.error("✗ dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version =
  process.argv[2] ||
  `${pkg.version || "0.0.0"}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

const outDir = resolve(root, "releases");
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `safenex-${version}.zip`);

try {
  // macOS/Linux 의 기본 zip 사용. Windows 는 PowerShell Compress-Archive 로 대체.
  if (process.platform === "win32") {
    execSync(
      `powershell Compress-Archive -Path dist\\* -DestinationPath "${outFile}" -Force`,
      { stdio: "inherit" },
    );
  } else {
    execSync(`cd dist && zip -r "${outFile}" .`, { stdio: "inherit", shell: "/bin/bash" });
  }
  console.log(`\n✓ OTA 번들 생성 완료: ${outFile}`);
  console.log("  → 마스터 계정으로 /settings/mobile-releases 에서 업로드하세요.");
} catch (e) {
  console.error("✗ zip 생성 실패:", e.message);
  process.exit(1);
}
