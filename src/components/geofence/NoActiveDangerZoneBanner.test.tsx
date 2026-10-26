import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { NO_ACTIVE_DANGER_ZONE_MESSAGE } from "@/lib/tracking/activeAlarmZones";

const zoneQuery = vi.hoisted(() => ({
  data: [] as { zone_category: string | null; is_active: boolean; is_deleted: boolean }[] | null,
  error: null as { message: string } | null,
  reject: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const q: {
        select: () => typeof q;
        eq: () => typeof q;
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise<unknown>;
      } = {
        select: () => q,
        eq: () => q,
        then: (resolve, reject) => {
          if (zoneQuery.reject) return Promise.reject(new Error("network")).then(resolve, reject);
          return Promise.resolve({ data: zoneQuery.data, error: zoneQuery.error }).then(resolve, reject);
        },
      };
      return q;
    },
  },
}));

import NoActiveDangerZoneBanner from "@/components/geofence/NoActiveDangerZoneBanner";

function renderBanner() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(
      <MemoryRouter>
        <NoActiveDangerZoneBanner projectId="proj-1" />
      </MemoryRouter>,
    );
  });
  return {
    el,
    async flush() {
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
    cleanup() {
      act(() => root.unmount());
      el.remove();
    },
  };
}

describe("NoActiveDangerZoneBanner", () => {
  it("shows the warning only when every readable zone is non-alarming", async () => {
    zoneQuery.data = [
      { zone_category: "일반", is_active: true, is_deleted: false },
      { zone_category: "작업구역", is_active: true, is_deleted: false },
    ];
    zoneQuery.error = null;
    zoneQuery.reject = false;
    const view = renderBanner();
    await view.flush();
    expect(view.el.textContent).toContain(NO_ACTIVE_DANGER_ZONE_MESSAGE);
    expect(view.el.querySelector("a")?.getAttribute("href")).toBe("/app/admin/site-control-map");
    view.cleanup();
  });

  it("stays hidden when an alarming zone exists", async () => {
    zoneQuery.data = [{ zone_category: "추락위험", is_active: true, is_deleted: false }];
    zoneQuery.error = null;
    zoneQuery.reject = false;
    const view = renderBanner();
    await view.flush();
    expect(view.el.textContent).toBe("");
    view.cleanup();
  });

  it("stays hidden when the read fails", async () => {
    zoneQuery.data = null;
    zoneQuery.error = { message: "rls" };
    zoneQuery.reject = false;
    const view = renderBanner();
    await view.flush();
    expect(view.el.querySelector("[data-testid='no-active-danger-zone-banner']")).toBeNull();

    zoneQuery.reject = true;
    zoneQuery.error = null;
    const thrown = renderBanner();
    await thrown.flush();
    expect(thrown.el.querySelector("[data-testid='no-active-danger-zone-banner']")).toBeNull();
    view.cleanup();
    thrown.cleanup();
  });
});
