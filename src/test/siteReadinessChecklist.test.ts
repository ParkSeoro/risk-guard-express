import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SiteReadinessChecklist TBM toast", () => {
  it("does not load signature blobs for the presence check", () => {
    const src = readFileSync("src/pages/SiteReadinessChecklist.tsx", "utf8");
    expect(src).toContain(".select('id, tbm_session_id, briefing_confirmed')");
    expect(src).toContain(".select('id').not('signature_data', 'is', null)");
    expect(src).not.toMatch(/tbm_participations[\s\S]{0,80}signature_data\)/);
  });
});
