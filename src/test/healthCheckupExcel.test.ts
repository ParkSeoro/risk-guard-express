import { describe, it, expect } from "vitest";
import {
  normalizeExcelDate,
  parseHealthCheckupRows,
  type WorkerRosterCandidate,
} from "@/lib/healthCheckupExcel";

const WORKERS: WorkerRosterCandidate[] = [
  { id: "w1", name: "홍길동", phone: "010-1111-2222", company_id: "c1" },
  { id: "w2", name: "김철수", phone: "010-3333-4444", company_id: "c1" },
  { id: "w3", name: "김철수", phone: "010-5555-6666", company_id: "c2" },
];

describe("Health Checkup Excel Bulk Import", () => {
  it("normalizes Excel serial numbers and date strings into YYYY-MM-DD", () => {
    expect(normalizeExcelDate(46346)).toBe("2026-11-20");
    expect(normalizeExcelDate("2026.11.5")).toBe("2026-11-05");
    expect(normalizeExcelDate("2026/11/20")).toBe("2026-11-20");
    expect(normalizeExcelDate("20261120")).toBe("2026-11-20");
    expect(normalizeExcelDate("invalid-date")).toBeNull();
  });

  it("matches workers uniquely, disambiguates duplicate names by phone, and flags errors/duplicates", () => {
    const parsed = parseHealthCheckupRows(
      [
        { "근로자명*": "홍길동", "종류*": "일반", 판정결과: "정상A", 실시일: "2026-11-20", 차기예정일: "2027-11-20", 검진기관: "서울센터" },
        // Duplicate name WITH phone -> matches w3 cleanly
        { "근로자명*": "김철수", 연락처: "01055556666", "종류*": "특수", 판정결과: "유소견D1", 실시일: "2026.11.21" },
        // Duplicate name WITHOUT phone -> flagged as error
        { "근로자명*": "김철수", "종류*": "일반", 판정결과: "정상B", 실시일: "2026-11-22" },
        // Unregistered worker -> flagged as error
        { "근로자명*": "없는사람", "종류*": "일반", 판정결과: "정상A" },
        // Already existing checkup -> duplicate
        { "근로자명*": "홍길동", "종류*": "배치전", 실시일: "2026-10-01" },
        // Blank trailing row -> skipped
        { "근로자명*": "", 연락처: "" },
      ],
      WORKERS,
      [{ worker_id: "w1", type: "배치전", conducted_date: "2026-10-01", scheduled_date: null }],
    );

    expect(parsed).toHaveLength(5);
    expect(parsed[0].status).toBe("valid");
    expect(parsed[0].workerId).toBe("w1");
    expect(parsed[1].status).toBe("valid");
    expect(parsed[1].workerId).toBe("w3");
    expect(parsed[1].companyId).toBe("c2");
    expect(parsed[2].status).toBe("error");
    expect(parsed[2].error).toContain("동명이인");
    expect(parsed[3].status).toBe("error");
    expect(parsed[3].error).toContain("찾을 수 없습니다");
    expect(parsed[4].status).toBe("duplicate");
  });
});
