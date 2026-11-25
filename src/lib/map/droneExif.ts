/**
 * Zero-dependency client-side JPEG EXIF GPS + DJI XMP Yaw/Altitude extractor
 * and aspect-preserving initial GeoCorners seeder for drone orthophotos.
 */
import { rotateCorners, type GeoCorners, type LatLngLiteral } from "@/lib/mapBounds";

export type DroneExifMetadata = {
  lat: number;
  lng: number;
  altitudeM?: number;
  relativeAltitudeM?: number;
  yawDeg?: number;
  source: "exif-gps";
};

function readU16(view: DataView, offset: number, littleEndian: boolean): number {
  if (offset < 0 || offset + 2 > view.byteLength) return 0;
  return view.getUint16(offset, littleEndian);
}

function readU32(view: DataView, offset: number, littleEndian: boolean): number {
  if (offset < 0 || offset + 4 > view.byteLength) return 0;
  return view.getUint32(offset, littleEndian);
}

function readRational(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 8 > view.byteLength) return null;
  const num = view.getUint32(offset, littleEndian);
  const den = view.getUint32(offset + 4, littleEndian);
  if (!den) return null;
  return num / den;
}

function readDms(view: DataView, offset: number, littleEndian: boolean): number | null {
  const d = readRational(view, offset, littleEndian);
  const m = readRational(view, offset + 8, littleEndian);
  const s = readRational(view, offset + 16, littleEndian);
  if (d == null || m == null || s == null) return null;
  if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(s)) return null;
  return d + m / 60 + s / 3600;
}

function extractDjiXmp(bytes: Uint8Array): { yawDeg?: number; relativeAltitudeM?: number } {
  // Scan ASCII/UTF-8 header for DJI XMP attributes (FlightYawDegree, GimbalYawDegree, RelativeAltitude)
  const maxLen = Math.min(bytes.byteLength, 131_072);
  let text = "";
  try {
    text = new TextDecoder("latin1").decode(bytes.subarray(0, maxLen));
  } catch {
    return {};
  }
  const result: { yawDeg?: number; relativeAltitudeM?: number } = {};

  const yawMatch =
    text.match(/drone-dji:GimbalYawDegree="([^"]+)"/i) ||
    text.match(/drone-dji:FlightYawDegree="([^"]+)"/i) ||
    text.match(/<drone-dji:GimbalYawDegree>([^<]+)<\/drone-dji:GimbalYawDegree>/i) ||
    text.match(/<drone-dji:FlightYawDegree>([^<]+)<\/drone-dji:FlightYawDegree>/i);
  if (yawMatch) {
    const n = Number(yawMatch[1]);
    if (Number.isFinite(n) && Math.abs(n) <= 360) result.yawDeg = n;
  }

  const altMatch =
    text.match(/drone-dji:RelativeAltitude="([^"]+)"/i) ||
    text.match(/<drone-dji:RelativeAltitude>([^<]+)<\/drone-dji:RelativeAltitude>/i);
  if (altMatch) {
    const n = Number(altMatch[1]);
    if (Number.isFinite(n) && n > 5 && n < 2000) result.relativeAltitudeM = n;
  }
  return result;
}

/**
 * Parse GPS coordinates (+ optional altitude & heading/yaw) from raw JPEG bytes.
 * Returns null if the image is not JPEG or has no valid WGS-84 EXIF GPS block.
 */
export function parseJpegExifGps(bytes: Uint8Array): DroneExifMetadata | null {
  if (!bytes || bytes.byteLength < 12) return null;
  // JPEG SOI marker 0xFF 0xD8
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let gpsLat: number | null = null;
  let gpsLng: number | null = null;
  let latRef = "N";
  let lngRef = "E";
  let altitudeM: number | undefined;
  let imgDirection: number | undefined;

  while (offset + 4 < view.byteLength) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    // Start of Scan (0xDA) or End of Image (0xD9) -> stop scanning headers
    if (marker === 0xda || marker === 0xd9) break;
    const segLen = view.getUint16(offset + 2, false);
    if (segLen < 2 || offset + 2 + segLen > view.byteLength) break;

    // APP1 marker (0xE1) with "Exif\0\0"
    if (
      marker === 0xe1 &&
      segLen >= 16 &&
      bytes[offset + 4] === 0x45 && // E
      bytes[offset + 5] === 0x78 && // x
      bytes[offset + 6] === 0x69 && // i
      bytes[offset + 7] === 0x66 && // f
      bytes[offset + 8] === 0x00 &&
      bytes[offset + 9] === 0x00
    ) {
      const tiffStart = offset + 10;
      const byteOrder = view.getUint16(tiffStart, false);
      const littleEndian = byteOrder === 0x4949; // "II"
      if (littleEndian || byteOrder === 0x4d4d) {
        const ifd0Offset = readU32(view, tiffStart + 4, littleEndian);
        const ifd0 = tiffStart + ifd0Offset;
        const entryCount = readU16(view, ifd0, littleEndian);
        let gpsIfdRel = 0;

        for (let i = 0; i < entryCount; i++) {
          const entryOff = ifd0 + 2 + i * 12;
          if (entryOff + 12 > view.byteLength) break;
          const tag = readU16(view, entryOff, littleEndian);
          if (tag === 0x8825) {
            gpsIfdRel = readU32(view, entryOff + 8, littleEndian);
            break;
          }
        }

        if (gpsIfdRel > 0) {
          const gpsIfd = tiffStart + gpsIfdRel;
          const gpsCount = readU16(view, gpsIfd, littleEndian);
          for (let i = 0; i < gpsCount; i++) {
            const entryOff = gpsIfd + 2 + i * 12;
            if (entryOff + 12 > view.byteLength) break;
            const tag = readU16(view, entryOff, littleEndian);
            const valOff = readU32(view, entryOff + 8, littleEndian);

            if (tag === 0x0001) {
              const ch = String.fromCharCode(bytes[entryOff + 8]);
              if (ch === "S" || ch === "N") latRef = ch;
            } else if (tag === 0x0002) {
              gpsLat = readDms(view, tiffStart + valOff, littleEndian);
            } else if (tag === 0x0003) {
              const ch = String.fromCharCode(bytes[entryOff + 8]);
              if (ch === "W" || ch === "E") lngRef = ch;
            } else if (tag === 0x0004) {
              gpsLng = readDms(view, tiffStart + valOff, littleEndian);
            } else if (tag === 0x0006) {
              const alt = readRational(view, tiffStart + valOff, littleEndian);
              if (alt != null && Number.isFinite(alt)) altitudeM = alt;
            } else if (tag === 0x0011) {
              const dir = readRational(view, tiffStart + valOff, littleEndian);
              if (dir != null && Number.isFinite(dir) && dir >= 0 && dir <= 360) {
                imgDirection = dir;
              }
            }
          }
        }
      }
    }
    offset += 2 + segLen;
  }

  if (gpsLat == null || gpsLng == null) return null;
  const lat = latRef === "S" ? -gpsLat : gpsLat;
  const lng = lngRef === "W" ? -gpsLng : gpsLng;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return null;

  const xmp = extractDjiXmp(bytes);
  return {
    lat,
    lng,
    ...(altitudeM != null ? { altitudeM } : {}),
    ...(xmp.relativeAltitudeM != null ? { relativeAltitudeM: xmp.relativeAltitudeM } : {}),
    ...(xmp.yawDeg != null
      ? { yawDeg: xmp.yawDeg }
      : imgDirection != null
        ? { yawDeg: imgDirection }
        : {}),
    source: "exif-gps",
  };
}

async function readHeadBytes(file: File, maxBytes = 131_072): Promise<Uint8Array> {
  const slice = file.slice(0, maxBytes);
  if (typeof slice.arrayBuffer === "function") {
    return new Uint8Array(await slice.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        resolve(new Uint8Array());
      }
    };
    reader.onerror = () => reject(reader.error || new Error("파일 읽기 실패"));
    reader.readAsArrayBuffer(slice);
  });
}

export async function extractDroneExifFromFile(file: File): Promise<DroneExifMetadata | null> {
  try {
    const bytes = await readHeadBytes(file, 131_072);
    return parseJpegExifGps(bytes);
  } catch {
    return null;
  }
}

/**
 * Build aspect-ratio-preserving GeoCorners centered on `center` (WGS-84).
 * Uses metric degrees (1 deg lat ≈ 111,320m, 1 deg lng ≈ 111,320m * cos(lat))
 * and optionally rotates by `yawDeg`.
 */
export function buildInitialCornersFromSeed(opts: {
  center: LatLngLiteral;
  aspectRatio?: number;
  halfWidthM?: number;
  relativeAltitudeM?: number;
  yawDeg?: number;
}): GeoCorners {
  const { center } = opts;
  const aspect =
    opts.aspectRatio && Number.isFinite(opts.aspectRatio) && opts.aspectRatio > 0.2 && opts.aspectRatio < 5
      ? opts.aspectRatio
      : 4 / 3;

  // Typical drone camera horizontal FOV ~75° -> half-width ≈ altitude * tan(37.5°) ≈ altitude * 0.77
  const derivedHalfW =
    opts.relativeAltitudeM && Number.isFinite(opts.relativeAltitudeM)
      ? Math.min(350, Math.max(40, opts.relativeAltitudeM * 0.75))
      : 110;
  const halfW =
    opts.halfWidthM && Number.isFinite(opts.halfWidthM)
      ? Math.min(800, Math.max(20, opts.halfWidthM))
      : derivedHalfW;
  const halfH = halfW / aspect;

  const metersPerDegLat = 111_320;
  const cosLat = Math.max(Math.cos((center.lat * Math.PI) / 180), 0.1);
  const metersPerDegLng = metersPerDegLat * cosLat;

  const dLat = halfH / metersPerDegLat;
  const dLng = halfW / metersPerDegLng;

  const base: GeoCorners = {
    tl: { lat: center.lat + dLat, lng: center.lng - dLng },
    tr: { lat: center.lat + dLat, lng: center.lng + dLng },
    bl: { lat: center.lat - dLat, lng: center.lng - dLng },
  };

  if (opts.yawDeg && Number.isFinite(opts.yawDeg) && Math.abs(opts.yawDeg) > 0.25) {
    return rotateCorners(base, opts.yawDeg);
  }
  return base;
}
