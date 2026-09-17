import { describe, expect, it } from "vitest";
import { needsConsent, postLoginPath } from "@/components/AuthGuard";

const agreedWorker = {
  agreed_to_terms: true,
  agreed_to_privacy: true,
  agreed_to_location: true,
  consent_agreed_at: "2026-01-01T00:00:00Z",
};

const unsigned = {
  agreed_to_terms: false,
  agreed_to_privacy: false,
  agreed_to_location: false,
  consent_agreed_at: null,
};

describe("needsConsent", () => {
  it("does not treat a missing profile as unsigned", () => {
    expect(needsConsent(null, ["worker"])).toBe(false);
  });

  it("still requires first-login flags once the profile row is present", () => {
    expect(needsConsent(unsigned, ["worker"])).toBe(true);
    expect(needsConsent(agreedWorker, ["worker"])).toBe(false);
  });
});

describe("postLoginPath", () => {
  it("does not send a still-loading profile to /consent", () => {
    expect(postLoginPath(["worker"], null, { rolesReady: true, loginIntent: "worker" })).toBe("");
  });

  it("sends a loaded unsigned worker to /consent", () => {
    expect(postLoginPath(["worker"], unsigned, { rolesReady: true, loginIntent: "worker" })).toBe(
      "/consent",
    );
  });
});
