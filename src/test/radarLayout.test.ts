import { describe, expect, it } from "vitest";
import { radarFrameHeight } from "@/components/weather/radarLayout";

describe("radarFrameHeight", () => {
  it("uses a shorter cap on the worker shell", () => {
    expect(radarFrameHeight("mobile")).toBe("min(55dvh, 480px)");
  });

  it("keeps the desktop iframe tall", () => {
    expect(radarFrameHeight("desktop")).toBe("calc(min(75vh, 680px))");
    expect(radarFrameHeight()).toBe("calc(min(75vh, 680px))");
  });
});
