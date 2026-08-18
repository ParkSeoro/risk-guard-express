import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, type ReactNode } from "react";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            is: () => ({
              gte: () => ({
                lte: () => ({
                  limit: async () => ({ data: [], error: null }),
                }),
              }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    profile: {
      display_name: "테스트",
      phone: "01012345678",
      agreed_to_location: true,
    },
    roles: ["worker"],
    hasRole: () => false,
  }),
}));

vi.mock("@/providers/SystemRealtimeProvider", () => ({
  useSystemRealtime: () => ({
    startGpsTracking: () => {},
    stopGpsTracking: () => {},
    gpsTracking: false,
    gpsSuspended: false,
    gpsError: null,
  }),
}));

import { GpsUiProvider } from "@/lib/tracking/gpsStatusUi";
import WorkerGlobalGps, { GpsBlockBadge } from "@/components/worker/WorkerGlobalGps";

describe("WorkerGlobalGps first paint", () => {
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

  function mount(node: ReactNode) {
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => {
      root!.render(<GpsUiProvider>{node}</GpsUiProvider>);
    });
  }

  it("GpsBlockBadge does not throw (missing useSetGpsUi would white-screen login)", () => {
    expect(() => mount(<GpsBlockBadge reason="no_consent" />)).not.toThrow();
    expect(el?.textContent).toBe("");
  });

  it("WorkerGlobalGps does not throw on first render after login", () => {
    expect(() => mount(<WorkerGlobalGps />)).not.toThrow();
    expect(el?.textContent).toBe("");
  });
});
