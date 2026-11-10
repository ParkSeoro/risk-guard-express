/**
 * One version compare for phone OTA and PC OTA.
 * Digit groups are read from the front. A missing group is 0.
 * `1.1.5-202611050559` is newer than `1.1.5`.
 * `1.1.4-202611059999` is older than `1.1.5`.
 */
export function cmpOtaVersion(a: string, b: string): number {
  const parts = (v: string) => {
    const nums = String(v).match(/\d+/g);
    return nums ? nums.map((n) => Number(n)) : [0];
  };
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * A fresh store install reports "builtin" / "내장" / "0.0.0".
 * Compare that against the version baked into the install so an older
 * screen bundle cannot replace a newer store app.
 */
export function isNewerScreenRelease(
  latestVersion: string | null | undefined,
  currentVersion: string | null | undefined,
  bakedVersion: string,
): boolean {
  const current = (currentVersion || "").trim();
  const baked = bakedVersion.trim();
  const base =
    !current || current === "내장" || current.toLowerCase() === "builtin" || current === "0.0.0"
      ? baked
      : current;
  return isOtaUpdateAvailable(latestVersion, base);
}

/** True when latest should replace current. A lower number never replaces a higher install. */
export function isOtaUpdateAvailable(
  latestVersion: string | null | undefined,
  currentVersion: string | null | undefined,
): boolean {
  const latest = (latestVersion || "").trim();
  const current = (currentVersion || "").trim();
  if (!latest) return false;
  if (!current || current === "내장" || current === "0.0.0" || current.startsWith("test-")) {
    return true;
  }
  return cmpOtaVersion(latest, current) > 0;
}
