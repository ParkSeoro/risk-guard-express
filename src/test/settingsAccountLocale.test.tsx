import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => {
  const memberships = {
    data: [
      {
        project_id: "p1",
        role_new: "master",
        position_new: null,
        company: null,
        projects: { id: "p1", name: "현장 A" },
      },
    ],
    error: null,
  };
  const projects = {
    data: [
      { id: "p1", name: "현장 A" },
      { id: "p2", name: "현장 B" },
    ],
    error: null,
  };
  const from = (table: string) => {
    const result = table === "projects" ? projects : memberships;
    const done = Promise.resolve(result);
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => done,
      then: done.then.bind(done),
    };
    return chain;
  };
  return { supabase: { from } };
});

vi.mock("@/contexts/AuthContext", () => {
  const user = { id: "u1", email: "master@example.com" };
  const profile = {
    display_name: "테스트 마스터",
    company: "시공사",
    phone: "01011112222",
    position: "마스터",
    default_project_id: "p1",
    ui_locale: "en",
    account_status: "active",
  };
  const roles = ["master"];
  const hasRole = (role: string) => role === "master";
  const refreshProfile = async () => {};
  return {
    useAuth: () => ({ user, profile, roles, refreshProfile, hasRole }),
  };
});

vi.mock("@/hooks/useAuditLog", () => ({
  useAuditLog: () => ({ log: () => {} }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: () => {} }),
}));

import SettingsAccount from "@/pages/SettingsAccount";

describe("SettingsAccount home site and locale", () => {
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

  async function renderAt(path: string) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <MemoryRouter initialEntries={[path]}>
          <SettingsAccount />
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("shows 앱 언어 only on the worker account page", async () => {
    await renderAt("/app/worker/account");
    expect(host?.textContent).toMatch(/기본 현장/);
    expect(host?.textContent).toMatch(/앱 언어/);
    expect(host?.textContent).toMatch(/English/);
    expect(host?.textContent).toMatch(/한국어/);
  });

  it("keeps web account Korean-only (no language picker)", async () => {
    await renderAt("/settings/account");
    expect(host?.textContent).toMatch(/기본 현장/);
    expect(host?.textContent).not.toMatch(/앱 언어/);
    expect(host?.textContent).not.toMatch(/English/);
  });
});
