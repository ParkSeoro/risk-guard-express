import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

const auth = { user: null as { id: string } | null, roles: [] as string[] };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    roles: auth.roles,
    hasRole: (r: string) => auth.roles.includes(r),
  }),
}));

import Manual from "@/pages/Manual";
import { MANUAL_AUDIENCE_STORAGE_KEY } from "@/lib/manualAudience";

describe("Manual page", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    window.localStorage.removeItem(MANUAL_AUDIENCE_STORAGE_KEY);
    auth.user = null;
    auth.roles = [];
  });

  async function renderPage() {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <Manual />
        </MemoryRouter>,
      );
    });
  }

  it("stays public: role gate, search, inquiry, no login wall", async () => {
    await renderPage();
    expect(el!.querySelector('[data-testid="manual-page"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="manual-role-gate"]')).toBeTruthy();
    expect(el!.textContent).toContain("이 시스템은 무엇인가요?");
    expect(el!.textContent).toContain("오류 신고 / 문의하기");
    expect(el!.textContent).toContain("PDF 저장/인쇄");
    expect(el!.textContent).toContain("따라하기 다시 보기");
    expect(el!.textContent).not.toContain("페이지를 찾을 수 없습니다");
  });

  it("shows worker day flow after picking 근로자 and remembers it", async () => {
    await renderPage();
    const pick = el!.querySelector('[data-testid="manual-pick-worker"]') as HTMLButtonElement;
    await act(async () => {
      pick.click();
    });
    expect(el!.querySelector('[data-testid="manual-worker-flow"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="manual-admin-flow"]')).toBeFalsy();
    expect(el!.textContent).toContain("하단 탭");
    expect(window.localStorage.getItem(MANUAL_AUDIENCE_STORAGE_KEY)).toBe("worker");
    expect(el!.querySelector('[data-testid="manual-switch-role"]')).toBeTruthy();
  });

  it("searches all roles even when 근로자 is selected", async () => {
    window.localStorage.setItem(MANUAL_AUDIENCE_STORAGE_KEY, "worker");
    await renderPage();
    const input = el!.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "전자결재");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el!.textContent).toContain("전자결재");
    expect(el!.textContent).toContain("전체 검색");
  });

  it("suggests admin from logged-in master when nothing is stored", async () => {
    auth.user = { id: "u1" };
    auth.roles = ["master"];
    await renderPage();
    expect(el!.querySelector('[data-testid="manual-audience-admin"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="manual-admin-flow"]')).toBeTruthy();
  });
});
