import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/functions/fetch-weather/index.ts", "utf8");
const siteWeather = readFileSync("src/pages/SiteWeather.tsx", "utf8");

describe("fetch-weather cache first", () => {
  it("does not call the dead Lovable weather proxy", () => {
    expect(src).not.toContain("LEGACY_WEATHER_PROXY_URL");
    expect(src).not.toContain("proxyLegacyWeather");
    expect(src).not.toContain("iqtiozscqwuacgzrlfzu");
  });

  it("prefers stored site coordinates and does not assign Seoul", () => {
    expect(src).toContain('.select("site_lat, site_lng, site_address")');
    expect(src).not.toMatch(/resolvedLat\s*=\s*37\.5665/);
    expect(src).not.toMatch(/resolvedLng\s*=\s*126\.978/);
    expect(src).toContain("isSeoulDefault");
  });

  it("reads cache before geocoding or Open-Meteo on the weather path", () => {
    const weatherPath = src.slice(src.indexOf('if (!project_id)'));
    const cacheAt = weatherPath.indexOf("weather_cache");
    const meteoAt = weatherPath.indexOf("fetchOpenMeteo");
    const nominatimAt = weatherPath.indexOf("geocodeNominatimOnly");
    expect(cacheAt).toBeGreaterThan(0);
    expect(meteoAt).toBeGreaterThan(cacheAt);
    expect(nominatimAt).toBeGreaterThan(cacheAt);
  });

  it("bounds geocoding with a short timeout and still fills from Open-Meteo", () => {
    expect(src).toContain("AbortSignal.timeout");
    expect(src).toMatch(/GEOCODE_TIMEOUT_MS\s*=\s*1500/);
    expect(src).toContain("https://api.open-meteo.com/v1/forecast");
  });

  it("keeps the geocode-only 404 body and does not write project coordinates", () => {
    expect(src).toContain('error: "주소를 찾을 수 없습니다"');
    const serve = src.slice(src.indexOf("serve(async"));
    expect(serve).not.toContain(".from(\"projects\").update");
    expect(serve).not.toContain("site_lat: resolved");
  });

  it("returns no-weather without an error toast field when coordinates are unknown", () => {
    expect(src).toContain("unavailable: true");
    expect(src).toContain("current: null");
    const save = siteWeather.slice(siteWeather.indexOf("const handleSaveAddress"));
    expect(save).toContain("geocode_only: true");
    expect(siteWeather).toContain("if (!data?.current)");
  });
});
