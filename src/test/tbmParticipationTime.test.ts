import { describe, expect, it } from "vitest";
import { formatTbmParticipationTime } from "@/lib/tbmParticipationTime";

const SIG = `data:image/png;base64,${"A".repeat(80)}`;

describe("formatTbmParticipationTime", () => {
  it("shows 미서명 until a real signature exists", () => {
    expect(formatTbmParticipationTime({
      participated_at: "2026-09-08T10:33:45+09:00",
      signature_data: null,
    })).toBe("미서명");
    expect(formatTbmParticipationTime({
      participated_at: "2026-09-08T10:33:45+09:00",
      signature_data: SIG,
    })).toMatch(/2026/);
  });
});
