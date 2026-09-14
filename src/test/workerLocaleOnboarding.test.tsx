import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    session: { user: { id: "u1" } },
    isAuthLoading: false,
    roles: ["worker"],
    profile: {
      agreed_to_terms: true,
      agreed_to_privacy: true,
      agreed_to_location: true,
      consent_agreed_at: "2026-01-01",
      ui_locale_chosen: false,
    },
    applyProfilePatch: () => {},
  }),
}));

vi.mock("@/hooks/useWorkerLocale", () => ({
  useWorkerLocale: () => ({ setLocale: async () => {} }),
}));

vi.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

import WorkerLocaleOnboarding from "@/pages/WorkerLocaleOnboarding";

describe("WorkerLocaleOnboarding", () => {
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

  it("offers Korean English Chinese Japanese on first launch", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <MemoryRouter>
          <WorkerLocaleOnboarding />
        </MemoryRouter>,
      );
    });
    expect(host.querySelector("[data-testid=locale-pick-ko]")).toBeTruthy();
    expect(host.querySelector("[data-testid=locale-pick-en]")).toBeTruthy();
    expect(host.querySelector("[data-testid=locale-pick-zh]")).toBeTruthy();
    expect(host.querySelector("[data-testid=locale-pick-ja]")).toBeTruthy();
    expect(host.textContent).toMatch(/한국어/);
    expect(host.textContent).toMatch(/English/);
  });
});
