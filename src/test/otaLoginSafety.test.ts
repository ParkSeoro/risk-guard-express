import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OTA_DOWNLOAD_TIMEOUT_MS,
  canApplyStagedOta,
  canStartOtaDownload,
  isAppShellPath,
} from "@/lib/native/otaUpdater";

function src(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("OTA stays off login for workers and managers", () => {
  it("treats only /app as a place where a bundle may download", () => {
    expect(isAppShellPath("/app")).toBe(true);
    expect(isAppShellPath("/app/worker/today")).toBe(true);
    expect(isAppShellPath("/app/admin/messenger")).toBe(true);
    expect(isAppShellPath("/login")).toBe(false);
    expect(isAppShellPath("/auth")).toBe(false);
    expect(isAppShellPath("/update-password")).toBe(false);
    expect(isAppShellPath("/worker")).toBe(false);
    expect(isAppShellPath("/worker/register")).toBe(false);
    expect(isAppShellPath("/worker/portal/token")).toBe(false);
    expect(isAppShellPath("/landing")).toBe(false);
  });

  it("requires a session and the app shell before a download", () => {
    expect(canStartOtaDownload(false, "/app/worker/today")).toBe(false);
    expect(canStartOtaDownload(true, "/login")).toBe(false);
    expect(canStartOtaDownload(true, "/auth")).toBe(false);
    expect(canStartOtaDownload(true, "/worker/register")).toBe(false);
    expect(canStartOtaDownload(true, "/app/worker/today")).toBe(true);
    expect(canStartOtaDownload(true, "/app/admin")).toBe(true);
  });

  it("applies a staged bundle only after the user has left the app", () => {
    expect(canApplyStagedOta(false, "/app/worker/today", "bundle-1")).toBe(false);
    expect(canApplyStagedOta(true, "/login", "bundle-1")).toBe(false);
    expect(canApplyStagedOta(true, "/auth", "bundle-1")).toBe(false);
    expect(canApplyStagedOta(true, "/worker/register", "bundle-1")).toBe(false);
    expect(canApplyStagedOta(true, "/app/admin/messenger", null)).toBe(false);
    expect(canApplyStagedOta(true, "/app/worker/today", "bundle-1")).toBe(true);
  });

  it("checks the route before touching the auth client", () => {
    const ota = src("src/lib/native/otaUpdater.ts");
    const run = ota.slice(ota.indexOf("async function runAutoCheck"));
    expect(run.indexOf("isAppShellPath(window.location.pathname)")).toBeGreaterThan(-1);
    expect(run.indexOf("isAppShellPath(window.location.pathname)")).toBeLessThan(
      run.indexOf("hasAuthSession"),
    );
    expect(run).toContain("silent: true");
    expect(run).toContain("preferImmediate: false");
    expect(run).not.toContain("CapacitorUpdater.set");
  });

  it("reloads only from the background apply path", () => {
    const ota = src("src/lib/native/otaUpdater.ts");
    const apply = ota.slice(ota.indexOf("async function applyStagedBundle"));
    const run = apply.slice(apply.indexOf("async function runAutoCheck"));
    expect(apply.slice(0, run.length ? apply.indexOf("async function runAutoCheck") : apply.length)).toContain(
      "canApplyStagedOta",
    );
    expect(apply).toContain("CapacitorUpdater.set");
    expect(ota).toContain("stagedBundleId = null");
    expect(OTA_DOWNLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("leaves both login handlers and the boot gate free of a bundle download", () => {
    const auth = src("src/pages/Auth.tsx");
    const workerAuth = src("src/lib/workerAuth.ts");
    const boot = src("src/lib/native/bootOtaGate.ts");
    const main = src("src/main.tsx");
    expect(auth).toContain("signInWorkerWithPhone");
    expect(auth).toContain("signInWithPassword");
    expect(auth).toContain("20_000");
    expect(auth).not.toContain("otaUpdater");
    expect(auth).not.toContain("CapacitorUpdater");
    expect(workerAuth).toContain("signInWithPassword");
    expect(workerAuth).not.toContain("otaUpdater");
    expect(workerAuth).not.toContain("CapacitorUpdater");
    const bootBody = boot.slice(boot.indexOf("export async function runBootOtaGate"));
    expect(bootBody).not.toContain(".download(");
    expect(bootBody).not.toContain(".set(");
    expect(boot).not.toContain("checkAndDownloadOta");
    expect(main).toContain("runBootOtaGate");
    expect(main).not.toContain("checkAndDownloadOta");
    const bootFn = main.slice(main.indexOf("async function boot"));
    expect(bootFn.indexOf("runBootOtaGate")).toBeGreaterThan(-1);
    expect(bootFn.indexOf("runBootOtaGate")).toBeLessThan(bootFn.indexOf("runBootStoreGate"));
    expect(bootFn.indexOf("runBootStoreGate")).toBeLessThan(bootFn.indexOf("runPreLoginOta"));
    expect(bootFn.indexOf("runPreLoginOta")).toBeLessThan(bootFn.indexOf('import("./App.tsx")'));
  });
});
