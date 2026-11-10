import { describe, expect, it } from "vitest";
import { indexWorkerJobTypes, jobTypeForSigner } from "@/lib/printJobType";

describe("print job type lookup", () => {
  const index = indexWorkerJobTypes([
    { id: "w1", phone: "010-3532-2385", job_type: "용접공" },
    { id: "w2", phone: "01038487887", job_type: "배관공" },
    { id: "w3", phone: "010-1111-2222", job_type: "  " },
  ]);

  it("matches a signer by worker id", () => {
    expect(jobTypeForSigner(index, { worker_id: "w1", worker_phone: "010-0000-0000" })).toBe("용접공");
  });

  it("matches a phone-only signer when the stored phone has hyphens", () => {
    expect(jobTypeForSigner(index, { worker_phone: "01038487887" })).toBe("배관공");
    expect(jobTypeForSigner(index, { phone: "010-3532-2385" })).toBe("용접공");
  });

  it("leaves a blank when the worker has no job type", () => {
    expect(jobTypeForSigner(index, { worker_id: "w3" })).toBe("");
    expect(jobTypeForSigner(index, { worker_id: "missing" })).toBe("");
  });
});
