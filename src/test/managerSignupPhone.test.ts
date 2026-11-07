import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auth = readFileSync("src/pages/Auth.tsx", "utf8");
const sql = readFileSync(
  "supabase/migrations/20261107103000_manager_signup_phone_required.sql",
  "utf8",
);

describe("manager signup phone", () => {
  it("requires a mobile number and stores it on the account", () => {
    const manager = auth.slice(auth.indexOf("const handleManagerSignup"), auth.indexOf("const handleSignup"));
    expect(manager).toContain("workerPhoneSchema.safeParse(phone)");
    expect(manager).toContain("phone: phoneParsed.data");
    expect(manager).toContain("_phone: phoneParsed.data");
    expect(auth).toContain("허가서 명단과 알림에 이 번호를 사용합니다.");
    expect(sql).toContain("account_kind");
    expect(sql).toContain("관리자 가입에는 휴대전화 번호가 필요합니다");
    expect(sql).not.toContain("INSERT INTO public.worker_entry_logs");
  });
});
