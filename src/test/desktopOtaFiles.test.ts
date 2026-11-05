import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { unzipBuffer, isHttpsDownloadUrl } = require("../../electron/desktopOtaFiles.cjs");

function writeZip(file: string, entries: Record<string, string>) {
  const script = `
import zipfile, json, sys
path, raw = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(path, "w") as z:
    for name, text in json.loads(raw).items():
        z.writestr(name, text)
`;
  execFileSync("python3", ["-c", script, file, JSON.stringify(entries)]);
}

describe("desktop OTA zip extract", () => {
  it("accepts only https download addresses", () => {
    expect(isHttpsDownloadUrl("https://example.com/a.zip")).toBe(true);
    expect(isHttpsDownloadUrl("http://127.0.0.1/a.zip")).toBe(false);
    expect(isHttpsDownloadUrl("file:///tmp/a.zip")).toBe(false);
  });

  it("extracts index.html and rejects entries outside the folder", () => {
    const root = mkdtempSync(join(tmpdir(), "safenex-zip-"));
    const out = join(root, "out");
    try {
      const zip = join(root, "bundle.zip");
      writeZip(zip, { "index.html": "<html></html>" });
      unzipBuffer(readFileSync(zip), out);
      expect(readFileSync(join(out, "index.html"), "utf8")).toContain("html");

      const slip = join(root, "slip.zip");
      writeZip(slip, { "../escaped.txt": "no" });
      expect(() => unzipBuffer(readFileSync(slip), out)).toThrow(/밖/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
