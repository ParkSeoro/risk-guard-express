import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { OfficialFooterFields } from "@/components/inspections/OfficialInspectionFields";
import type { OfficialApprovalSignerInput } from "@/lib/legalForms/officialInspectionForms";

describe("OfficialFooterFields approval stamps", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
  });

  async function render(approvals?: OfficialApprovalSignerInput[]) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <OfficialFooterFields
          type="facility_sf009"
          payload={{
            dig_signers: ["홍ALK", "", ""],
            contractor_signers: ["직접입력", "", ""],
            action_notes: "조치",
          }}
          approvals={approvals}
          onChange={() => {}}
        />,
      );
    });
  }

  it("keeps manual signature inputs before any approval line", async () => {
    await render();
    const inputs = host!.querySelectorAll("input");
    expect(inputs).toHaveLength(6);
    expect((inputs[0] as HTMLInputElement).value).toBe("홍ALK");
    expect((inputs[3] as HTMLInputElement).value).toBe("직접입력");
  });

  it("shows name, company, and approval time on screen after approval", async () => {
    await render([
      {
        step: "작성자",
        step_order: 1,
        approver_name: "차강찬",
        company_name: "진남토건",
        status: "승인",
        approved_at: "2026-10-14T05:00:00.000Z",
        approval_version: 1,
      },
      {
        step: "최종결재(승인)",
        step_order: 2,
        approver_name: "박서로",
        company_name: "에어리퀴드코리아",
        status: "승인",
        approved_at: "2026-10-14T06:30:00.000Z",
        approval_version: 1,
      },
    ]);
    expect(host!.querySelectorAll("input")).toHaveLength(0);
    expect(host!.textContent).toContain("박서로 · 에어리퀴드코리아 · 2026.10.14 15:30");
    expect(host!.textContent).toContain("차강찬 · 진남토건 · 2026.10.14 14:00");
    expect(host!.textContent).not.toContain("홍ALK");
    expect(host!.textContent).not.toContain("직접입력");
  });
});
