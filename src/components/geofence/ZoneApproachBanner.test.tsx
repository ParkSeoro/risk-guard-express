import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ZoneApproachBanner from "@/components/geofence/ZoneApproachBanner";

describe("ZoneApproachBanner", () => {
  it("hides a meter figure when GPS accuracy is worse than the distance", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    act(() => {
      root.render(
        <ZoneApproachBanner
          zoneName="굴착구"
          distanceM={12}
          accuracyM={40}
          onDismiss={() => {}}
        />,
      );
    });
    expect(el.textContent).toContain("위험구역 접근");
    expect(el.textContent).toContain("굴착구");
    expect(el.textContent).toContain("근처");
    expect(el.textContent).not.toMatch(/약 12m/);
    act(() => root.unmount());
    el.remove();
  });
});
