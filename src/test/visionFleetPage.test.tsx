import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

const auth = { roles: ["master"] as string[] };

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock("@/components/vision/VisionLivePane", () => ({
  default: () => <div data-testid="vision-live-pane-stub" />,
}));

const cameraRows = [
  {
    id: "c1",
    camera_id: "cam1",
    name: "정문",
    health_state: "online",
    gateway_id: "g1",
    playback_url: null,
    company_id: null,
  },
];

function chain(result: { data: unknown; error: null }) {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.eq = () => q;
  q.or = () => q;
  q.in = () => q;
  q.order = async () => result;
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) =>
      table === "project_companies" || table === "companies"
        ? chain({ data: [], error: null })
        : chain({ data: cameraRows, error: null }),
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    roles: auth.roles,
    hasRole: (r: string) => auth.roles.includes(r),
  }),
}));

const applyCompanyFilter = (query: unknown) => query;

vi.mock("@/components/AppLayout", () => ({
  useGlobalProjectAccess: () => ({
    selectedProject: "p1",
    scopeStatus: "ready",
    accessibleCompanyIds: null,
    applyCompanyFilter,
  }),
}));

vi.mock("@/hooks/useMobileAccess", () => ({
  useMobileAccess: () => ({
    projectId: "p1",
    scopeStatus: "ready",
    applyCompanyFilter,
  }),
}));

import VisionFleet from "@/pages/VisionFleet";
import MobileVisionEvents from "@/pages/MobileVisionEvents";

describe("VisionFleet role wall", () => {
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

  async function mount(node: React.ReactNode) {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<MemoryRouter>{node}</MemoryRouter>);
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("lets master add, rename, and delete cameras", async () => {
    auth.roles = ["master"];
    await mount(<VisionFleet />);
    expect(el!.querySelector('[data-testid="vision-fleet"]')).toBeTruthy();
    expect(el!.textContent).toContain("설정은 마스터만 합니다");
    expect(el!.querySelector('[data-testid="vision-camera-company"]')).toBeTruthy();
    expect(el!.textContent).toContain("현장 공용");
    expect(el!.querySelector('[data-testid="vision-vps-setup"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="vision-camera-manage"]')).toBeTruthy();
    expect(el!.textContent).toContain("추가");
    expect(el!.textContent).toContain("수정");
    expect(el!.textContent).toContain("삭제");
    expect(el!.textContent).not.toContain("설치 키트");
    expect(el!.textContent).not.toContain("현장 Gateway");
  });

  it("shows only the 4-pane wall to a site manager", async () => {
    auth.roles = ["site_manager"];
    await mount(<VisionFleet />);
    expect(el!.textContent).toContain("현장 화면입니다");
    expect(el!.querySelector('[data-testid="vision-quad-grid"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="vision-vps-setup"]')).toBeNull();
    expect(el!.querySelector('[data-testid="vision-camera-manage"]')).toBeNull();
    expect(el!.textContent).not.toContain("추가");
    expect(el!.textContent).not.toContain("수정");
    expect(el!.textContent).not.toContain("삭제");
  });

  it("keeps mobile vision as a single-camera view for every role", async () => {
    auth.roles = ["master"];
    await mount(<MobileVisionEvents />);
    expect(el!.querySelector('[data-testid="mobile-vision-events"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="mobile-vision-player"]')).toBeTruthy();
    expect(el!.querySelector('[data-testid="vision-quad-grid"]')).toBeNull();
    expect(el!.textContent).toContain("설정은 PC 비전 관제에서 합니다");
    expect(el!.querySelector('[data-testid="vision-vps-setup"]')).toBeNull();
    expect(el!.textContent).not.toContain("수정");
    expect(el!.textContent).not.toContain("삭제");
  });
});
