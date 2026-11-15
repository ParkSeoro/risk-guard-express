import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

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

import { ConstructionInfoMissingBanner } from "@/components/ConstructionInfoMissingBanner";

describe("ConstructionInfoMissingBanner", () => {
  it("opens the admin project page instead of a missing /projects address", async () => {
    render(
      <MemoryRouter>
        <ConstructionInfoMissingBanner projectId="site-1" />
      </MemoryRouter>,
    );

    const link = await screen.findByRole("link", { name: /현장 상세에서 입력하기/ });
    expect(link.getAttribute("href")).toBe("/app/admin/project/site-1");
    await waitFor(() => {
      expect(link.getAttribute("href")).not.toContain("/projects/");
    });
  });
});
