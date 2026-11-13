/** OTA row names. Android's Play floor never moves onto desktop or iOS. */

export type OtaReleasePlatform = "android" | "desktop" | "ios";

/** CI header `both` writes one zip onto three rows. An empty header is `both`. */
export function otaPublishPlatforms(header: string): OtaReleasePlatform[] | null {
  const value = header.trim().toLowerCase();
  if (!value || value === "both") return ["android", "desktop", "ios"];
  if (value === "android" || value === "desktop" || value === "ios") return [value];
  return null;
}

/** Only the android row stores the Play versionCode. iOS and desktop stay empty. */
export function minNativeForOtaRow(
  platform: string,
  resolvedMin: string | null,
): string | null {
  return platform === "android" ? resolvedMin : null;
}

/** Shell lookup. Web and desktop do not use this. */
export function nativeOtaLookupPlatform(platform: string): "android" | "ios" | null {
  if (platform === "android" || platform === "ios") return platform;
  return null;
}

/**
 * Full-screen store prompt. Android uses Play. iOS uses the App Store only
 * after a real listing URL exists, so an empty URL never blocks login.
 */
export function shouldOfferNativeStoreUpdate(
  platform: string,
  needed: boolean,
  snoozed: boolean,
  storeUrl: string,
): boolean {
  if (!needed || snoozed) return false;
  if (platform === "android") return true;
  if (platform === "ios") return storeUrl.trim().length > 0;
  return false;
}
