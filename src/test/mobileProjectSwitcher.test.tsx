import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: { default_project_id: "p1" },
    refreshProfile: async () => {},
    hasRole: (role: string) => role === "master",
  }),
}));

vi.mock("@/hooks/useMobileAccess", () => ({
  useMobileAccess: () => ({
    projectId: "p2",
    setProjectId: () => {},
  }),
}));

vi.mock("@/hooks/useMobileProjectList", () => ({
  useMobileProjectList: () => ({
    projects: [
      { id: "p1", name: "현장 A" },
      { id: "p2", name: "현장 B" },
    ],
  }),
}));

vi.mock("@/contexts/PreviewContext", () => ({
  usePreview: () => ({ isPreview: false, previewProjectId: "" }),
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import MobileProjectSwitcher from "@/components/mobile/MobileProjectSwitcher";

describe("MobileProjectSwitcher", () => {
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

  it("marks the profile default and offers 기본으로 지정 for the current site", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<MobileProjectSwitcher />);
    });
    const switcher = host.querySelector("[data-testid=mobile-project-switcher]");
    expect(switcher).toBeTruthy();
    expect(switcher?.textContent).toMatch(/기본 현장/);
    expect(switcher?.textContent).toMatch(/기본으로 지정/);
    expect(switcher?.textContent).toMatch(/현장 A/);
    expect(switcher?.textContent).toMatch(/현장 B/);
  });
});
