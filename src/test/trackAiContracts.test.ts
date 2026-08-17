import { describe, expect, it } from "vitest";
import {
  buildRiskAiBatchRequestBody,
  digitsOnlyPhone,
  isJsonContentType,
  parseRiskAiBatchJsonResult,
  trackIdentityClaimMismatch,
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
