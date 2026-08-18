export type WeatherLayout = "desktop" | "mobile";

/** Radar iframe height — shorter on the worker shell so the bottom tabs do not clip it. */
export function radarFrameHeight(layout: WeatherLayout = "desktop"): string {
  return layout === "mobile" ? "min(55dvh, 480px)" : "calc(min(75vh, 680px))";
}
