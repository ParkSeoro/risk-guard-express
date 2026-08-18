import { cmpVersion, getChannel } from "@/lib/native/otaUpdater";
import { isNativeApp, nativePlatform } from "@/lib/native/platform";
import { supabase } from "@/integrations/supabase/client";

export type NativeIdentity = { version: string; build: string };

const SNOOZE_KEY = "safenex.nativeStoreSnoozeDate";

/** True when the installed AAB/IPA is older than the server minimum. */
export function nativeNeedsStoreUpdate(
  current: NativeIdentity,
  minNative: string | null | undefined,
): boolean {
  const min = String(minNative || "").trim();
  if (!min) return false;
  if (/^\d+$/.test(min)) {
    const build = Number(String(current.build).match(/\d+/)?.[0] || "0");
    return build < Number(min);
  }
  return cmpVersion(min, current.version || "0.0.0") > 0;
}

export function todaySnoozeStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isStoreUpdateSnoozed(now = todaySnoozeStamp()): boolean {
  try {
    return localStorage.getItem(SNOOZE_KEY) === now;
  } catch {
    return false;
  }
}

export function snoozeStoreUpdateToday(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, todaySnoozeStamp());
  } catch {
    /* ignore */
  }
}

export async function getNativeIdentity(): Promise<NativeIdentity | null> {
  if (!isNativeApp()) return null;
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return {
      version: String(info.version || "0.0.0"),
      build: String(info.build || "0"),
    };
  } catch {
    return null;
  }
}

export type NativeStoreUpdateState = {
  applicable: boolean;
  needed: boolean;
  current: NativeIdentity | null;
  minNative: string | null;
};

/** Android native only — iOS has no Play listing. */
export async function fetchNativeStoreUpdateState(): Promise<NativeStoreUpdateState> {
  const empty: NativeStoreUpdateState = {
    applicable: false,
    needed: false,
    current: null,
    minNative: null,
  };
  if (!isNativeApp() || nativePlatform() !== "android") return empty;
  const current = await getNativeIdentity();
  if (!current) return empty;
  try {
    const { data, error } = await supabase.rpc("get_latest_app_release", {
      _channel: getChannel(),
    } as any);
    if (error) return { applicable: true, needed: false, current, minNative: null };
    const release: any = Array.isArray(data) ? data[0] : data;
    const minNative = release?.min_native_version ? String(release.min_native_version) : null;
    return {
      applicable: true,
      needed: nativeNeedsStoreUpdate(current, minNative),
      current,
      minNative,
    };
  } catch {
    return { applicable: true, needed: false, current, minNative: null };
  }
}
