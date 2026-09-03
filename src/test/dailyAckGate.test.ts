import { describe, expect, it } from "vitest";
import { isDailyAckComplete, shouldForceDailyAckDialog } from "@/lib/dailyWorkAck";

describe("daily ack home gate", () => {
  it("treats today's ack row or entry-log TBM flag as complete", () => {
    expect(isDailyAckComplete({ hasAckRow: true, tbmConfirmed: false })).toBe(true);
    expect(isDailyAckComplete({ hasAckRow: false, tbmConfirmed: true })).toBe(true);
    expect(isDailyAckComplete({ hasAckRow: false, tbmConfirmed: false })).toBe(false);
    expect(isDailyAckComplete({})).toBe(false);
  });

  it("does not reopen the signature dialog before status is loaded", () => {
    expect(shouldForceDailyAckDialog({
      hydrated: false,
      checkedIn: true,
      ackDone: false,
    })).toBe(false);
  });

  it("does not reopen after the worker already signed (tab switch / app resume)", () => {
    expect(shouldForceDailyAckDialog({
      hydrated: true,
      checkedIn: true,
      ackDone: true,
    })).toBe(false);
  });

  it("still forces the dialog when checked in without a signature", () => {
    expect(shouldForceDailyAckDialog({
      hydrated: true,
      checkedIn: true,
      ackDone: false,
    })).toBe(true);
  });

  it("never forces the dialog on the GPS diagnostics page", () => {
    expect(shouldForceDailyAckDialog({
      hydrated: true,
      diagnosticsOnly: true,
      checkedIn: true,
      ackDone: false,
    })).toBe(false);
  });
});
