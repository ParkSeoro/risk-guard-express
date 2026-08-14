import { describe, expect, it } from "vitest";
import { formatWorkerBulkRowError } from "@/lib/workerBulk";

/** Mirror of WorkerBulkImportDialog phone helpers (keep in sync). */
function phoneDigits(s: string): string {
  return String(s || "").replace(/\D/g, "");
}

function normalizePhone(s: unknown): string {
  if (s == null || s === "") return "";
  let raw = String(s).trim();
  if (typeof s === "number" && Number.isFinite(s)) {
    raw = String(Math.trunc(s));
  }
  let d = phoneDigits(raw);
  if (d.length === 10 && d.startsWith("10")) d = `0${d}`;
  if (d.length === 11 && d.startsWith("010")) {
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return raw;
}

describe("worker bulk phone normalize", () => {
  it("formats digit strings", () => {
    expect(normalizePhone("01036462260")).toBe("010-3646-2260");
    expect(normalizePhone("010-3646-2260")).toBe("010-3646-2260");
  });

  it("restores leading 0 lost by Excel numbers", () => {
    expect(normalizePhone(1036462260)).toBe("010-3646-2260");
  });
});

describe("formatWorkerBulkRowError", () => {
  it("maps gen_random_bytes SQL error to a short Korean label", () => {
    expect(formatWorkerBulkRowError("function gen_random_bytes(integer) does not exist"))
      .toBe("QR 토큰 생성 실패(DB)");
  });

  it("maps known RPC codes", () => {
    expect(formatWorkerBulkRowError("INVALID_ROW")).toBe("이름·전화·직종이 올바르지 않음");
    expect(formatWorkerBulkRowError("OTHER_COMPANY")).toBe("다른 회사 소속 전화번호");
  });
});
