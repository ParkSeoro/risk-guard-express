import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  CANONICAL_PROJECT_KEY,
  isActiveProjectStorageKey,
  LEGACY_PROJECT_KEY,
  markProjectViewingSession,
  pickBootProjectId,
  pickSessionProjectId,
  readActiveProjectId,
  resetProjectViewingSessionForTests,
  writeActiveProjectId,
} from "@/lib/activeProject";

describe("activeProject (F-07)", () => {
  afterEach(() => {
    localStorage.removeItem(CANONICAL_PROJECT_KEY);
    localStorage.removeItem(LEGACY_PROJECT_KEY);
    resetProjectViewingSessionForTests();
  });

  it("prefers selectedProjectId and mirrors it onto currentProjectId", () => {
    localStorage.setItem(CANONICAL_PROJECT_KEY, "proj-a");
    localStorage.setItem(LEGACY_PROJECT_KEY, "proj-old");
    expect(readActiveProjectId()).toBe("proj-a");
    expect(localStorage.getItem(LEGACY_PROJECT_KEY)).toBe("proj-a");
  });

  it("promotes a legacy-only currentProjectId onto the canonical key", () => {
    localStorage.setItem(LEGACY_PROJECT_KEY, "proj-legacy");
    expect(readActiveProjectId()).toBe("proj-legacy");
    expect(localStorage.getItem(CANONICAL_PROJECT_KEY)).toBe("proj-legacy");
  });

  it("writes both keys and notifies the same tab only when the id changes", () => {
    const seen: string[] = [];
    const onChange = () => seen.push("changed");
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onChange);
    writeActiveProjectId("proj-b");
    expect(localStorage.getItem(CANONICAL_PROJECT_KEY)).toBe("proj-b");
    expect(localStorage.getItem(LEGACY_PROJECT_KEY)).toBe("proj-b");
    expect(seen).toEqual(["changed"]);
    writeActiveProjectId("proj-b");
    expect(seen).toEqual(["changed"]);
    window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onChange);
  });

  it("treats both storage keys as the active-project key", () => {
    expect(isActiveProjectStorageKey(CANONICAL_PROJECT_KEY)).toBe(true);
    expect(isActiveProjectStorageKey(LEGACY_PROJECT_KEY)).toBe(true);
    expect(isActiveProjectStorageKey("other")).toBe(false);
  });

  it("prefers profile default over localStorage when both are allowed", () => {
    expect(
      pickBootProjectId({
        allowedIds: ["a", "b", "c"],
        defaultProjectId: "b",
        storedId: "c",
      }),
    ).toBe("b");
  });

  it("falls back to stored then first allowed", () => {
    expect(
      pickBootProjectId({
        allowedIds: ["a", "b"],
        defaultProjectId: "gone",
        storedId: "b",
      }),
    ).toBe("b");
    expect(
      pickBootProjectId({
        allowedIds: ["a", "b"],
        defaultProjectId: null,
        storedId: "",
      }),
    ).toBe("a");
  });

  it("cold start uses the profile default even if last night's site is stored", () => {
    expect(
      pickSessionProjectId({
        allowedIds: ["a", "b", "c"],
        defaultProjectId: "a",
        storedId: "c",
        defaultReady: true,
      }),
    ).toBe("a");
  });

  it("after the user picks a site, GPS/list reloads keep that site", () => {
    markProjectViewingSession();
    expect(
      pickSessionProjectId({
        allowedIds: ["a", "b", "c"],
        defaultProjectId: "a",
        storedId: "c",
        defaultReady: true,
      }),
    ).toBe("c");
  });

  it("does not lock last night's site before the profile default is known", () => {
    expect(
      pickSessionProjectId({
        allowedIds: ["a", "b"],
        defaultProjectId: "a",
        storedId: "b",
        defaultReady: false,
      }),
    ).toBe("b");
    expect(
      pickSessionProjectId({
        allowedIds: ["a", "b"],
        defaultProjectId: "a",
        storedId: "b",
        defaultReady: true,
      }),
    ).toBe("a");
  });

  it("GPS and project list use the session picker, not a fresh boot", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/hooks/useProjectAccess.ts", "utf8")).toContain("pickSessionProjectId");
    expect(readFileSync("src/hooks/useMobileAccess.ts", "utf8")).toContain("pickSessionProjectId");
    expect(readFileSync("src/components/worker/WorkerGlobalGps.tsx", "utf8")).toContain("pickSessionProjectId");
    expect(readFileSync("src/contexts/AuthContext.tsx", "utf8")).toContain("resetProjectViewingSession");
  });
});
