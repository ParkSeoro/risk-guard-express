import { describe, expect, it } from "vitest";
import {
  buildRiskAiBatchRequestBody,
  digitsOnlyPhone,
  isJsonContentType,
  parseRiskAiBatchJsonResult,
  resolveZoneEventWorkerKey,
  shouldIgnoreLowAccuracyFix,
  trackIdentityClaimMismatch,
  zoneEventLookbackSince,
} from "@/lib/trackAiContracts";

describe("track-location identity binding", () => {
  it("normalizes phone digits", () => {
    expect(digitsOnlyPhone("010-1234-5678")).toBe("01012345678");
    expect(digitsOnlyPhone(null)).toBe("");
  });

  it("allows empty body claims (server fills)", () => {
    expect(
      trackIdentityClaimMismatch({
        profilePhoneDigits: "01012345678",
        resolvedWorkerId: "w1",
        resolvedWorkerPhoneDigits: "01012345678",
        claimedWorkerId: null,
        claimedWorkerPhone: null,
      }),
    ).toBe(false);
  });

  it("rejects claimed worker_id that is not the JWT-resolved worker", () => {
    expect(
      trackIdentityClaimMismatch({
        profilePhoneDigits: "01012345678",
        resolvedWorkerId: "w1",
        resolvedWorkerPhoneDigits: "01012345678",
        claimedWorkerId: "w-other",
        claimedWorkerPhone: null,
      }),
    ).toBe(true);
  });

  it("rejects claimed phone that differs from profile", () => {
    expect(
      trackIdentityClaimMismatch({
        profilePhoneDigits: "01012345678",
        resolvedWorkerId: "w1",
        resolvedWorkerPhoneDigits: "01012345678",
        claimedWorkerId: "w1",
        claimedWorkerPhone: "010-9999-8888",
      }),
    ).toBe(true);
  });

  it("accepts matching claims", () => {
    expect(
      trackIdentityClaimMismatch({
        profilePhoneDigits: "01012345678",
        resolvedWorkerId: "w1",
        resolvedWorkerPhoneDigits: "01012345678",
        claimedWorkerId: "w1",
        claimedWorkerPhone: "010-1234-5678",
      }),
    ).toBe(false);
  });
});

describe("risk-ai batch JSON contract", () => {
  it("forces stream:false and response_mode:json", () => {
    const body = buildRiskAiBatchRequestBody(
      { project_id: "p1", equipment: "굴착기" },
      { subProcess: "굴착 - 토사 운반", count: 10, index: 2 },
    );
    expect(body.stream).toBe(false);
    expect(body.response_mode).toBe("json");
    expect(body.process_name).toBe("굴착 - 토사 운반");
    expect(body.batch_size).toBe(10);
    expect(body.batch_index).toBe(2);
  });

  it("accepts only JSON content types", () => {
    expect(isJsonContentType("application/json; charset=utf-8")).toBe(true);
    expect(isJsonContentType("text/event-stream; charset=utf-8")).toBe(false);
  });

  it("parses items[] and rejects missing items", () => {
    expect(parseRiskAiBatchJsonResult({ items: [{ hazard: "a" }], source: "ai" }).items).toHaveLength(
      1,
    );
    expect(() => parseRiskAiBatchJsonResult({ source: "ai" })).toThrow(/missing items/);
    expect(() => parseRiskAiBatchJsonResult({ items: [], error: "boom" })).toThrow(/boom/);
  });
});

describe("track-location accuracy + zone-event lookup (F-06, F-09, F-10)", () => {
  it("does not let force_restricted_check bypass the 100m accuracy gate", () => {
    expect(shouldIgnoreLowAccuracyFix(150, 0)).toBe(true);
    expect(shouldIgnoreLowAccuracyFix(80, 0)).toBe(false);
    expect(shouldIgnoreLowAccuracyFix(150, 2)).toBe(false);
  });

  it("uses worker_id as the event key instead of a dead ternary / name match", () => {
    expect(
      resolveZoneEventWorkerKey({
        workerQrId: null,
        workerPhone: null,
        workerId: "w-roster",
      }),
    ).toEqual({ col: "worker_qr_id", val: "w-roster" });
    expect(
      resolveZoneEventWorkerKey({
        workerQrId: "w-qr",
        workerPhone: "010",
        workerId: "w-roster",
      }),
    ).toEqual({ col: "worker_qr_id", val: "w-qr" });
    expect(resolveZoneEventWorkerKey({ workerQrId: null, workerPhone: null, workerId: null })).toBe(
      null,
    );
  });

  it("looks back 12 hours instead of UTC midnight", () => {
    const now = new Date("2026-08-18T01:00:00Z");
    const since = zoneEventLookbackSince(now);
    expect(since.toISOString()).toBe("2026-08-17T13:00:00.000Z");
    // Old UTC-midnight window would have started at 2026-08-18T00:00:00Z
    expect(since.getTime()).toBeLessThan(Date.parse("2026-08-18T00:00:00Z"));
  });
});
