import { describe, expect, it } from "vitest";
import { canUploadProjectLibrary } from "@/lib/projectLibraryUpload";

describe("canUploadProjectLibrary", () => {
  it("allows the roles that the library insert policy accepts", () => {
    expect(canUploadProjectLibrary("master")).toBe(true);
    expect(canUploadProjectLibrary("project_admin")).toBe(true);
    expect(canUploadProjectLibrary("safety_manager")).toBe(true);
  });

  it("keeps the upload control off for other project roles", () => {
    for (const role of ["site_manager", "site_supervisor", "supervisor", "worker", "viewer", "", null]) {
      expect(canUploadProjectLibrary(role)).toBe(false);
    }
  });
});
