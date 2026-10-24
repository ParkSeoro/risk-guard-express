import { describe, expect, it } from "vitest";
import { toast } from "sonner";
import { normalizeError, toKoreanWarning } from "@/lib/errors";
import { installKoreanToasts } from "@/lib/installKoreanToasts";
import { localizeToastCopy } from "@/hooks/use-toast";

describe("toKoreanWarning", () => {
  it("maps health checkup RLS text to Korean", () => {
    expect(
      toKoreanWarning("new row violates row-level security policy for table health_checkups"),
    ).toBe("이 내용을 저장할 권한이 없습니다. 관리자에게 문의하세요.");
  });

  it("keeps Korean warnings", () => {
    expect(toKoreanWarning("시행일을 입력하세요")).toBe("시행일을 입력하세요");
  });

  it("maps the submitted document lock code without remapping every 42501", () => {
    expect(toKoreanWarning("submitted_document_locked")).toBe(
      "승인된 문서는 잠겨 있어 이 칸을 바꿀 수 없습니다.",
    );
    expect(toKoreanWarning("submitted_document_locked (42501)")).toBe(
      "승인된 문서는 잠겨 있어 이 칸을 바꿀 수 없습니다.",
    );
    expect(toKoreanWarning("WORK_PERMIT_APPROVAL_RPC_REQUIRED")).toBe(
      "허가서 승인은 결재선으로만 처리할 수 있습니다.",
    );
    expect(
      toKoreanWarning("WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다."),
    ).toBe("WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다.");
  });

  it("drops an English tail after a Korean prefix", () => {
    expect(toKoreanWarning("저장 실패: new row violates row-level security policy")).toBe(
      "이 내용을 저장할 권한이 없습니다. 관리자에게 문의하세요.",
    );
  });

  it("hides unknown English", () => {
    expect(toKoreanWarning("something went sideways in the handler")).toBe(
      "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    );
  });

  it("reads Postgrest error objects", () => {
    const n = normalizeError({
      code: "42501",
      message: "new row violates row-level security policy for table health_checkups",
    });
    expect(n.kind).toBe("permission");
    expect(n.message).toBe("권한이 없어 접근이 거부되었습니다.");
    expect(n.message).not.toMatch(/[A-Za-z]{4,}/);
  });

  it("rewrites sonner error toasts", () => {
    installKoreanToasts();
    const historyOf = () =>
      (toast as unknown as { getHistory: () => { id: unknown; title?: string }[] }).getHistory();
    const id = toast.error("new row violates row-level security policy for table health_checkups");
    expect(historyOf().find((row) => row.id === id)?.title).toBe(
      "이 내용을 저장할 권한이 없습니다. 관리자에게 문의하세요.",
    );
    const kept = toast.error("시행일을 입력하세요");
    expect(historyOf().find((row) => row.id === kept)?.title).toBe("시행일을 입력하세요");
  });

  it("rewrites destructive toast descriptions", () => {
    expect(localizeToastCopy({
      variant: "destructive",
      title: "저장 실패",
      description: "new row violates row-level security policy for table health_checkups",
    })).toEqual({
      variant: "destructive",
      title: "저장 실패",
      description: "이 내용을 저장할 권한이 없습니다. 관리자에게 문의하세요.",
    });
  });
});
