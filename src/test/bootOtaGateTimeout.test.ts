import { describe, expect, it } from "vitest";
import { BOOT_OTA_GATE_TIMEOUT_MS } from "@/lib/native/bootOtaGate";

describe("bootOtaGate timeout constant", () => {
  it("keeps a finite pre-login budget so splash cannot hang forever", () => {
    expect(BOOT_OTA_GATE_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(BOOT_OTA_GATE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });
});
