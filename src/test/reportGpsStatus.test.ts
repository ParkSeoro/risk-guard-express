import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: null, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc },
}));

import {
  GPS_STATUS_REPORT_DEBOUNCE_MS,
  gpsStatusReportPayload,
  reportWorkerGpsStatus,
  resetGpsStatusReportForTests,
} from "@/lib/tracking/reportGpsStatus";

describe("gpsStatusReportPayload", () => {
  it("does not report while the tracker is still booting", () => {
    expect(
      gpsStatusReportPayload({ tracking: false, suspended: false, block: null }),
    ).toBeUndefined();
  });

  it("reports null while tracking and fence_probe_failed while suspended", () => {
    expect(
      gpsStatusReportPayload({ tracking: true, suspended: false, block: null }),
    ).toBeNull();
    expect(
      gpsStatusReportPayload({ tracking: true, suspended: true, block: null }),
    ).toBe("fence_probe_failed");
  });

  it("forwards the chip reason when tracking is off", () => {
    expect(
      gpsStatusReportPayload({
        tracking: false,
        suspended: false,
        block: "no_checkin",
      }),
    ).toBe("no_checkin");
    expect(
      gpsStatusReportPayload({
        tracking: false,
        suspended: false,
        block: "no_consent",
      }),
    ).toBe("no_consent");
    expect(
      gpsStatusReportPayload({
        tracking: true,
        suspended: false,
        block: "identity_mismatch",
      }),
    ).toBe("identity_mismatch");
  });
});

describe("reportWorkerGpsStatus debounce (F-08)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    rpc.mockClear();
    resetGpsStatusReportForTests();
  });

  afterEach(() => {
    resetGpsStatusReportForTests();
    vi.useRealTimers();
  });

  it("sends only the last reason after debounce and skips identical repeats", async () => {
    reportWorkerGpsStatus("proj-1", "no_checkin");
    reportWorkerGpsStatus("proj-1", "no_consent");
    expect(rpc).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GPS_STATUS_REPORT_DEBOUNCE_MS);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("report_worker_gps_status", {
      _project_id: "proj-1",
      _block_reason: "no_consent",
    });

    reportWorkerGpsStatus("proj-1", "no_consent");
    await vi.advanceTimersByTimeAsync(GPS_STATUS_REPORT_DEBOUNCE_MS);
    expect(rpc).toHaveBeenCalledTimes(1);

    reportWorkerGpsStatus("proj-1", null);
    await vi.advanceTimersByTimeAsync(GPS_STATUS_REPORT_DEBOUNCE_MS);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("report_worker_gps_status", {
      _project_id: "proj-1",
      _block_reason: null,
    });
  });

  it("does not send coordinates", async () => {
    reportWorkerGpsStatus("proj-1", "fence_probe_failed");
    await vi.advanceTimersByTimeAsync(GPS_STATUS_REPORT_DEBOUNCE_MS);
    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["_block_reason", "_project_id"]);
    expect(args).not.toHaveProperty("lat");
    expect(args).not.toHaveProperty("lng");
    expect(args).not.toHaveProperty("latitude");
    expect(args).not.toHaveProperty("longitude");
  });
});
