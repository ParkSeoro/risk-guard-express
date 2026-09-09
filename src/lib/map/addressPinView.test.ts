import { describe, expect, it } from "vitest";
import {
  ADDRESS_PIN_MAX_ZOOM,
  ADDRESS_PIN_RADIUS_M,
  ADDRESS_PIN_VIEW_ZOOM,
  ADDRESS_PIN_ZONES_MAX_ZOOM,
  addressPinBounds,
  addressPinFitSpec,
  hasGeoreferencedDrawing,
  parseProjectAddressPin,
} from "@/lib/map/addressPinView";

describe("parseProjectAddressPin", () => {
  it("reads a geocoded project pin", () => {
    expect(
      parseProjectAddressPin({
        site_lat: 34.76,
        site_lng: 127.72,
        site_address: "전남 여수시 적량동",
      }),
    ).toEqual({ lat: 34.76, lng: 127.72, address: "전남 여수시 적량동" });
  });

  it("rejects missing or bogus coordinates", () => {
    expect(parseProjectAddressPin(null)).toBeNull();
    expect(parseProjectAddressPin({ site_lat: null, site_lng: 127 })).toBeNull();
    expect(parseProjectAddressPin({ site_lat: 0, site_lng: 0 })).toBeNull();
    expect(parseProjectAddressPin({ site_lat: 400, site_lng: 127 })).toBeNull();
  });
});

describe("hasGeoreferencedDrawing", () => {
  it("requires both an image and corners", () => {
    expect(hasGeoreferencedDrawing({ image_url: "https://x/a.png" }, { tl: 1 })).toBe(true);
    expect(hasGeoreferencedDrawing({ image_url: "https://x/a.png" }, null)).toBe(false);
    expect(hasGeoreferencedDrawing({ image_url: null }, { tl: 1 })).toBe(false);
    expect(hasGeoreferencedDrawing(null, { tl: 1 })).toBe(false);
  });
});

describe("addressPinFitSpec", () => {
  const pin = { lat: 34.76, lng: 127.72 };

  it("fits a 500m lot around the pin, not a building", () => {
    expect(addressPinFitSpec({ pin, zoneCount: 0 })).toEqual({
      mode: "pin",
      radiusM: ADDRESS_PIN_RADIUS_M,
      maxZoom: ADDRESS_PIN_MAX_ZOOM,
    });
    expect(ADDRESS_PIN_VIEW_ZOOM).toBe(16);
    expect(ADDRESS_PIN_RADIUS_M).toBe(500);
  });

  it("widens to pin+zones without going to street zoom", () => {
    expect(addressPinFitSpec({ pin, zoneCount: 3 })).toEqual({
      mode: "pin+zones",
      radiusM: ADDRESS_PIN_RADIUS_M,
      maxZoom: ADDRESS_PIN_ZONES_MAX_ZOOM,
    });
    expect(ADDRESS_PIN_ZONES_MAX_ZOOM).toBeLessThanOrEqual(17);
  });

  it("fits existing zones when the project has no pin", () => {
    expect(addressPinFitSpec({ pin: null, zoneCount: 2 })).toEqual({
      mode: "zones",
      maxZoom: ADDRESS_PIN_ZONES_MAX_ZOOM,
    });
  });

  it("does nothing without a pin or zones", () => {
    expect(addressPinFitSpec({ pin: null, zoneCount: 0 })).toEqual({ mode: "none" });
  });
});

describe("addressPinBounds", () => {
  it("is roughly 1km across", () => {
    const b = addressPinBounds({ lat: 37.5, lng: 127.0 }, 500);
    const northM = (b.north - b.south) * 111_195;
    expect(northM).toBeGreaterThan(950);
    expect(northM).toBeLessThan(1050);
    expect(b.west).toBeLessThan(127);
    expect(b.east).toBeGreaterThan(127);
  });
});
