import { afterEach, describe, expect, it, vi } from "vitest";

const ch: {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
} = {
  on: vi.fn(() => ch),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    cb?.("SUBSCRIBED");
    return ch;
  }),
  send: vi.fn(async () => "ok"),
};

const { channel, removeChannel } = vi.hoisted(() => {
  const channel = vi.fn();
  const removeChannel = vi.fn(async () => {});
  return { channel, removeChannel };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel, removeChannel },
}));

import {
  clearGpsCalibrationCache,
  fetchProjectGpsCalibration,
  GPS_CAL_CHANGED_EVENT,
  gpsCalChannelName,
} from "@/lib/tracking/gpsCalibration";
import {
  notifyGpsCalibrationChanged,
  watchGpsCalibrationInvalidation,
} from "@/lib/tracking/gpsCalibrationRealtime";

describe("gps calibration realtime (F-13)", () => {
  afterEach(() => {
    clearGpsCalibrationCache();
    ch.on.mockClear();
    ch.subscribe.mockClear();
    ch.send.mockClear();
    channel.mockReset();
    channel.mockReturnValue(ch);
    removeChannel.mockClear();
  });

  it("names a project-scoped broadcast channel", () => {
    expect(gpsCalChannelName("proj-1")).toBe("gps-cal:proj-1");
    expect(GPS_CAL_CHANGED_EVENT).toBe("gps_cal_changed");
  });

  it("broadcasts a status-only payload and busts the local cache", async () => {
    channel.mockReturnValue(ch);
    let n = 0;
    const fetcher = async () => {
      n += 1;
      return {
        d_lat: 0.0002,
        d_lng: 0,
        accuracy_m: 10,
        site_map_id: "m",
        map_lat: 1,
        map_lng: 2,
        raw_lat: 0,
        raw_lng: 0,
        calibrated_at: "2026-08-18T00:00:00Z",
      };
    };
    await fetchProjectGpsCalibration("proj-1", fetcher);
    expect(n).toBe(1);
    await notifyGpsCalibrationChanged("proj-1");
    expect(ch.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: GPS_CAL_CHANGED_EVENT,
      payload: { projectId: "proj-1" },
    });
    const payload = ch.send.mock.calls[0]?.[0] as { payload: Record<string, unknown> };
    expect(payload.payload).not.toHaveProperty("lat");
    expect(payload.payload).not.toHaveProperty("lng");
    await fetchProjectGpsCalibration("proj-1", fetcher);
    expect(n).toBe(2);
  });

  it("clears cache when a remote changed event arrives", async () => {
    channel.mockReturnValue(ch);
    const unsub = watchGpsCalibrationInvalidation("proj-2");
    const handler = ch.on.mock.calls[0]?.[2] as () => void;
    expect(typeof handler).toBe("function");

    let n = 0;
    const fetcher = async () => {
      n += 1;
      return {
        d_lat: 0.0003,
        d_lng: 0,
        accuracy_m: 10,
        site_map_id: "m",
        map_lat: 1,
        map_lng: 2,
        raw_lat: 0,
        raw_lng: 0,
        calibrated_at: "2026-08-18T00:00:00Z",
      };
    };
    await fetchProjectGpsCalibration("proj-2", fetcher);
    expect(n).toBe(1);
    handler();
    await fetchProjectGpsCalibration("proj-2", fetcher);
    expect(n).toBe(2);
    unsub();
  });
});
