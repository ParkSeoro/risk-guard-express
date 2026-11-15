import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { constructionInfoEntryPath } from "@/components/ConstructionInfoMissingBanner";

const access = vi.hoisted(() => ({ userCompanyId: null as string | null }));

vi.mock("@/integrations/supabase/client", () => {
  const result = { data: [], error: null };
  const query = {
    select: () => query,
    eq: () => query,
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return { supabase: { from: () => query } };
});

vi.mock("@/components/AppLayout", () => ({
  useGlobalProjectAccessOptional: () =>
    access.userCompanyId ? { userCompanyId: access.userCompanyId } : null,
}));

import { ConstructionInfoMissingBanner } from "@/components/ConstructionInfoMissingBanner";

describe("construction info entry", () => {
  it("sends a company user to that company's construction tab", () => {
    expect(constructionInfoEntryPath("site-1", "co-9")).toBe(
      "/app/admin/companies/co-9?tab=construction",
    );
  });

  it("sends a master without a company to the project company list", () => {
    expect(constructionInfoEntryPath("site-1", null)).toBe(
      "/app/admin/project/site-1?tab=companies",
    );
  });

  it("uses the signed-in company on the banner link", async () => {
    access.userCompanyId = "co-9";
    render(
      <MemoryRouter>
        <ConstructionInfoMissingBanner projectId="site-1" />
      </MemoryRouter>,
    );
    const link = await screen.findByRole("link", { name: /현장 상세에서 입력하기/ });
    expect(link.getAttribute("href")).toBe("/app/admin/companies/co-9?tab=construction");
    access.userCompanyId = null;
  });
});
