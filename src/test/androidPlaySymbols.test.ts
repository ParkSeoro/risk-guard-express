import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/patch-android-play-symbols.py");

const CAPACITOR_APP_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "org.safenex.app"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "org.safenex.app"
        versionCode 467
        versionName "1.1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
`;

function patch(src: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aab-sym-"));
  const path = join(dir, "build.gradle");
  writeFileSync(path, src);
  execFileSync("python3", [SCRIPT, path], { encoding: "utf8" });
  return readFileSync(path, "utf8");
}

describe("patch-android-play-symbols", () => {
  it("turns on R8 and packages native symbol tables", () => {
    const out = patch(CAPACITOR_APP_GRADLE);
    expect(out).toContain("minifyEnabled true");
    expect(out).not.toMatch(/minifyEnabled false/);
    expect(out).toContain("debugSymbolLevel 'SYMBOL_TABLE'");
    expect(out).toContain('ndkVersion "27.2.12479018"');
  });

  it("is idempotent", () => {
    const once = patch(CAPACITOR_APP_GRADLE);
    const twice = patch(once);
    expect(twice).toBe(once);
  });
});
