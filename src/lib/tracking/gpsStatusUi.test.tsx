import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  GPS_BLOCK_CHIP,
  GPS_BLOCK_HINT,
  GPS_QUALITY_CHIP,
  GpsStatusChip,
  gpsQualityOf,
} from "@/lib/tracking/gpsStatusUi";

describe("GPS header chip copy", () => {
  it("keeps block reasons short enough for the SafeNex header", () => {
    for (const label of Object.values(GPS_BLOCK_CHIP)) {
      expect(label.length).toBeLessThanOrEqual(10);
      expect(label.startsWith("GPS")).toBe(true);
    }
    expect(GPS_BLOCK_CHIP.identity_mismatch).toBe("GPS 신원");
    expect(GPS_BLOCK_HINT.fence_probe_failed).toMatch(/복귀/);
  });

  it("maps reported accuracy to quality bands without changing siren thresholds", () => {
    expect(gpsQualityOf(10)).toBe("good");
    expect(gpsQualityOf(20)).toBe("good");
    expect(gpsQualityOf(21)).toBe("fair");
    expect(gpsQualityOf(40)).toBe("fair");
    expect(gpsQualityOf(41)).toBe("poor");
    expect(gpsQualityOf(null)).toBe("unknown");
    expect(GPS_QUALITY_CHIP.good).toBe("GPS 양호");
    expect(GPS_QUALITY_CHIP.unknown).toBe("GPS 현장");
  });

  it("exposes data-gps-quality on the tracking chip", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(<GpsStatusChip tracking block={null} accuracyM={12} />);
    });
    const chip = el.querySelector("[data-gps-quality]");
    expect(chip?.getAttribute("data-gps-quality")).toBe("good");
    expect(chip?.textContent).toBe("GPS 양호");
    act(() => root.unmount());
    el.remove();
  });
});
