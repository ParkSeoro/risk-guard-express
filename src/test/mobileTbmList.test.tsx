import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

const harness = vi.hoisted(() => {
  const filters: string[][] = [];
  const pending: Array<(value: { data: unknown; error: null }) => void> = [];
  let rows: unknown[] = [];
  let hangFirst = false;
  let built = 0;

  function query() {
    const seen: string[] = [];
    filters.push(seen);
    built += 1;
    const index = built;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (key: string, value: string) => {
      seen.push(`${key}=${value}`);
      return q;
    };
    q.or = () => q;
    q.in = () => q;
    q.order = () => q;
    q.limit = () => q;
    if (hangFirst && index === 1) {
      const waiting = new Promise<{ data: unknown; error: null }>((resolve) => {
        pending.push(resolve);
      });
      q.then = (
        resolve: (value: { data: unknown; error: null }) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => waiting.then(resolve, reject);
    } else {
      const result = { data: rows, error: null };
      q.then = (resolve: (value: { data: unknown; error: null }) => unknown) =>
        Promise.resolve(result).then(resolve);
    }
    return q;
  }

  const access = {
    projectId: "p1",
    companyId: null as string | null,
    role: "viewer",
    isMaster: false,
    scopeStatus: "pending" as "pending" | "ready",
    applyCompanyFilter: (q: { eq: (key: string, value: string) => unknown }) =>
      q.eq("company_id", "00000000-0000-0000-0000-000000000000"),
  };

  return {
    filters,
    pending,
    query,
    access,
    setRows(next: unknown[]) {
      rows = next;
    },
    setHangFirst(next: boolean) {
      hangFirst = next;
    },
    reset() {
      filters.length = 0;
      pending.length = 0;
      rows = [];
      hangFirst = false;
      built = 0;
      access.projectId = "p1";
      access.companyId = null;
      access.role = "viewer";
      access.isMaster = false;
      access.scopeStatus = "pending";
      access.applyCompanyFilter = (q) =>
        q.eq("company_id", "00000000-0000-0000-0000-000000000000");
    },
  };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/lib/tbmLifecycle", () => ({
  closeExpiredTbmSessions: vi.fn(async () => ({ ok: true, closed: 0 })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => harness.query(),
    channel: () => ({ on: () => ({ on: () => ({ subscribe: () => ({}) }) }) }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: { user_id: "u1", display_name: "관리자", phone: "" },
    roles: ["safety_manager"],
    hasRole: () => false,
  }),
}));

vi.mock("@/hooks/useMobileAccess", () => ({
  useMobileAccess: () => harness.access,
}));

import MobileTbm from "@/pages/MobileTbm";

describe("MobileTbm company scope", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    harness.reset();
  });

  async function mount() {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <MobileTbm />
        </MemoryRouter>,
      );
    });
  }

  async function settle() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it("does not query until company scope is ready, then shows today's log", async () => {
    await mount();
    await settle();
    expect(harness.filters).toHaveLength(0);
    expect(el!.textContent).not.toContain("오늘 생성된 TBM이 없습니다.");

    harness.access.role = "safety_manager";
    harness.access.companyId = "co-1";
    harness.access.scopeStatus = "ready";
    harness.access.applyCompanyFilter = (q) => q.eq("company_id", "co-1");
    harness.setRows([
      { id: "s1", title: "굴착 TBM", tbm_date: "2026-11-09", is_active: true, location: "A동" },
    ]);

    await act(async () => {
      root!.render(
        <MemoryRouter>
          <MobileTbm />
        </MemoryRouter>,
      );
    });
    await settle();

    expect(harness.filters).toHaveLength(1);
    expect(harness.filters[0]).toContain("company_id=co-1");
    expect(harness.filters[0].join(" ")).not.toContain("00000000-0000-0000-0000-000000000000");
    expect(el!.textContent).toContain("굴착 TBM");
    expect(el!.textContent).not.toContain("오늘 생성된 TBM이 없습니다.");
  });

  it("keeps the later list when an earlier query resolves empty", async () => {
    harness.access.scopeStatus = "ready";
    harness.access.role = "safety_manager";
    harness.access.companyId = "co-1";
    harness.access.applyCompanyFilter = (q) => q.eq("company_id", "co-1");
    harness.setHangFirst(true);
    harness.setRows([]);

    await mount();
    await settle();
    expect(harness.pending).toHaveLength(1);

    harness.access.applyCompanyFilter = (q) => q.eq("company_id", "co-1");
    harness.setRows([
      { id: "s2", title: "오늘 일지", tbm_date: "2026-11-09", is_active: true, location: "B동" },
    ]);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <MobileTbm />
        </MemoryRouter>,
      );
    });
    await settle();
    expect(el!.textContent).toContain("오늘 일지");

    await act(async () => {
      harness.pending[0]({ data: [], error: null });
    });
    await settle();
    expect(el!.textContent).toContain("오늘 일지");
    expect(el!.textContent).not.toContain("오늘 생성된 TBM이 없습니다.");
  });
});
