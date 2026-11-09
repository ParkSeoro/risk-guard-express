import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const access = vi.hoisted(() => ({
  selectedProject: "p1",
  loading: false,
  scopeStatus: "pending" as "pending" | "ready",
}));

vi.mock("@/components/tbm/TbmManager", () => ({
  default: () => <div data-testid="tbm-manager">TBM 목록</div>,
}));

vi.mock("@/components/AppLayout", () => ({
  useGlobalProjectAccess: () => access,
}));

import TbmLogs from "@/pages/TbmLogs";

describe("TbmLogs company scope", () => {
  let root: Root | null = null;
  let el: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    el?.remove();
    root = null;
    el = null;
    access.selectedProject = "p1";
    access.loading = false;
    access.scopeStatus = "pending";
  });

  async function render() {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(<TbmLogs />);
    });
  }

  it("keeps the journal unmounted until company scope is ready", async () => {
    await render();
    expect(el!.textContent).toContain("로딩 중");
    expect(el!.querySelector("[data-testid=tbm-manager]")).toBeNull();

    access.scopeStatus = "ready";
    await act(async () => {
      root!.render(<TbmLogs />);
    });
    expect(el!.querySelector("[data-testid=tbm-manager]")).toBeTruthy();
    expect(el!.textContent).toContain("TBM 일지");
  });
});
