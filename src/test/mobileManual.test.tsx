import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import MobileManual from "@/pages/MobileManual";

describe("MobileManual", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
  });

  it("renders the in-shell manual with a back button", async () => {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <MobileManual />
        </MemoryRouter>,
      );
    });
    expect(el.querySelector('[data-testid="mobile-manual"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="mobile-page-header"]')).toBeTruthy();
    expect(el.querySelector('[aria-label="뒤로"]')).toBeTruthy();
    expect(el.textContent).toContain("사용 설명서");
    expect(el.textContent).not.toContain("페이지를 찾을 수 없습니다");
  });
});
