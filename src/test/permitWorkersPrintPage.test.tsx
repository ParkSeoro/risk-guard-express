import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import PermitWorkersPrintPage from "@/components/permits/PermitWorkersPrintPage";

describe("PermitWorkersPrintPage", () => {
  it("renders the full crew in one table (no fixed N-per-page chunks)", async () => {
    const workers = Array.from({ length: 34 }, (_, i) => ({
      id: `w${i + 1}`,
      name: `근로자${i + 1}`,
      phone: "01012345678",
      company_name: "청원산기(주)",
    }));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <PermitWorkersPrintPage
          workTitle="배관"
          permitDate="2026-08-24"
          projectName="GSC"
          workers={workers}
        />,
      );
    });

    const tables = host.querySelectorAll("table");
    expect(tables).toHaveLength(1);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(34);
    expect(host.textContent).toContain("근로자1");
    expect(host.textContent).toContain("근로자34");
    expect(host.textContent).not.toMatch(/\d+\/\d+/);
    expect(host.querySelector(".permit-crew-sign")?.className).toContain("h-11");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  it("puts TBM on a second sheet without splitting crew into JS pages", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <PermitWorkersPrintPage
          workers={[{ id: "w1", name: "홍길동", company_name: "A" }]}
          tbmTitle="아침 TBM"
          tbmParticipants={[
            { id: "t1", worker_name: "홍길동", company_name: "A" },
            { id: "t2", worker_name: "김철수", company_name: "A" },
          ]}
        />,
      );
    });

    expect(host.querySelectorAll(".permit-crew-sheet")).toHaveLength(2);
    expect(host.querySelectorAll("table")).toHaveLength(2);
    expect(host.textContent).toContain("TBM 참여·서명");

    await act(async () => {
      root.unmount();
    });
    host.remove();
  });
});
