/**
 * Phone install version baked into the next Play AAB.
 * package.json version and androidVersionCode must match. The AAB workflow reads those.
 * PC installer version stays separate.
 */
export const APP_VERSION = "1.1.9";

/** Play versionCode. Higher than 478, which is the build already on Play. */
export const ANDROID_VERSION_CODE = 479;

/** Builtin Capgo markers mean the screen baked into this install. */
export function formatBundledScreenLabel(currentVersion: string, bakedVersion: string): string {
  const current = currentVersion.trim();
  const builtin =
    !current ||
    current === "내장" ||
    current.toLowerCase() === "builtin" ||
    current === "0.0.0";
  return builtin ? `${bakedVersion} (내장)` : current;
}
