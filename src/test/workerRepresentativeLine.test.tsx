import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkerRepresentativeLine } from "@/components/workers/WorkerRepresentativeLine";

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    update: () => chain,
    insert: async () => ({ error: null }),
  };
  return { supabase: { from: () => chain } };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const companies = [
  { id: "c1", name: "한빛건설" },
  { id: "c2", name: "푸른토건" },
];

describe("WorkerRepresentativeLine", () => {
  it("asks for a company before the designate controls appear", () => {
    render(
      <WorkerRepresentativeLine
        projectId="p1"
        companyId=""
        companies={companies}
        companiesReady
        onCompanyChange={() => {}}
        workers={[{ id: "w1", name: "김근로", company_id: "c1" }]}
        canEdit
      />,
    );
    expect(screen.getByText("회사를 고르면 근로자대표를 지정할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("회사")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "지정" })).not.toBeInTheDocument();
  });

  it("shows the designate controls once a company is chosen", () => {
    render(
      <WorkerRepresentativeLine
        projectId="p1"
        companyId="c1"
        companies={companies}
        companiesReady
        onCompanyChange={() => {}}
        workers={[{ id: "w1", name: "김근로", company_id: "c1" }]}
        canEdit
      />,
    );
    expect(screen.getByText("이 회사 근로자대표: 없음")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지정" })).toBeInTheDocument();
  });

  it("keeps a locked company on the line without a company picker", () => {
    render(
      <WorkerRepresentativeLine
        projectId="p1"
        companyId="c1"
        companies={companies}
        companiesReady
        companyLocked
        workers={[{ id: "w1", name: "김근로", company_id: "c1" }]}
        canEdit
      />,
    );
    expect(screen.getByText("한빛건설")).toBeInTheDocument();
    expect(screen.queryByLabelText("회사")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "지정" })).toBeInTheDocument();
  });
});
