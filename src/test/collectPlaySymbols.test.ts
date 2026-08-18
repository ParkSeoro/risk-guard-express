import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/collect-play-symbols.py");

describe("collect-play-symbols", () => {
  it("zips merged_native_libs ABI folders when AGP did not emit a sidecar zip", () => {
    const root = mkdtempSync(join(tmpdir(), "play-sym-"));
    const build = join(root, "app-build");
    const dest = join(root, "out");
    const lib = join(
      build,
      "intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib",
    );
    mkdirSync(join(lib, "arm64-v8a"), { recursive: true });
    mkdirSync(join(build, "outputs/mapping/release"), { recursive: true });
    writeFileSync(join(lib, "arm64-v8a", "libbarhopper_v3.so"), "fake-so");
    writeFileSync(join(build, "outputs/mapping/release/mapping.txt"), "mapping");
    execFileSync("python3", [SCRIPT, build, dest], { encoding: "utf8" });
    expect(existsSync(join(dest, "mapping.txt"))).toBe(true);
    expect(existsSync(join(dest, "native-debug-symbols.zip"))).toBe(true);
  });
});
