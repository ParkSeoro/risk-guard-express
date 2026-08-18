import { afterEach, describe, expect, it } from "vitest";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  CANONICAL_PROJECT_KEY,
  isActiveProjectStorageKey,
  LEGACY_PROJECT_KEY,
  readActiveProjectId,
  writeActiveProjectId,
} from "@/lib/activeProject";

describe("activeProject (F-07)", () => {
  afterEach(() => {
    localStorage.removeItem(CANONICAL_PROJECT_KEY);
    localStorage.removeItem(LEGACY_PROJECT_KEY);
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
});
