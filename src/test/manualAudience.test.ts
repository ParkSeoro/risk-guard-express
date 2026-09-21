import { describe, expect, it } from "vitest";
import {
  isManualAudience,
  manualAudienceFromRoles,
  resolveManualAudience,
} from "@/lib/manualAudience";

describe("manualAudienceFromRoles", () => {
  it("maps site_supervisor to 관리감독자, not 감리", () => {
    expect(manualAudienceFromRoles(["site_supervisor"])).toBe("supervisor");
    expect(manualAudienceFromRoles(["supervisor"])).toBe("admin");
  });

  it("maps worker-like roles to worker", () => {
    expect(manualAudienceFromRoles(["worker"])).toBe("worker");
    expect(manualAudienceFromRoles(["contractor"])).toBe("worker");
  });

  it("maps safety/site/master to admin", () => {
    expect(manualAudienceFromRoles(["safety_manager"])).toBe("admin");
    expect(manualAudienceFromRoles(["master"])).toBe("admin");
    expect(manualAudienceFromRoles(["site_manager"])).toBe("admin");
  });

  it("prefers stored choice over live roles", () => {
    expect(resolveManualAudience("worker", ["master"])).toBe("worker");
    expect(resolveManualAudience(null, ["master"])).toBe("admin");
  });

  it("rejects unknown storage values", () => {
    expect(isManualAudience("pm")).toBe(false);
    expect(isManualAudience("admin")).toBe(true);
  });
});
