import { describe, expect, it } from "vitest";
import { lookupWorkerBanFields, resolveBanSubject } from "@/lib/tracking/resolveBanSubject";

describe("resolveBanSubject", () => {
  it("returns membership company when project missing", async () => {
    const sub = await resolveBanSubject(null, { phone: "01012345678", companyId: "co-1" });
    expect(sub).toEqual({
      worker_id: null,
      company_id: "co-1",
      job_type: null,
    });
  });

  it("skips worker lookup without phone", async () => {
    const fields = await lookupWorkerBanFields("proj-1", null);
    expect(fields).toEqual({ worker_id: null, company_id: null, job_type: null });
  });
});
