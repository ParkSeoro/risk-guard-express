import { describe, expect, it } from "vitest";
import { tbmParticipationTimeLabel } from "@/lib/tbmParticipationTime";

const SIG = `data:image/png;base64,${"A".repeat(80)}`;

describe("tbmParticipationTimeLabel", () => {
  it("does not treat roster-sync time as a signature", () => {
    expect(
      tbmParticipationTimeLabel({
        signature_data: "",
        participated_at: "2026-09-08T01:33:45.000Z",
      }),
    ).toBe("미서명");
  });

  it("shows the sign time when a real signature exists", () => {
    const label = tbmParticipationTimeLabel({
      signature_data: SIG,
      participated_at: "2026-09-08T22:05:11.000Z",
    });
    expect(label).not.toBe("미서명");
    expect(label.length).toBeGreaterThan(4);
  });
});
