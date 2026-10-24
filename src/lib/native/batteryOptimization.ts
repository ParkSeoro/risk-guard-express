import { Capacitor, registerPlugin } from "@capacitor/core";

type BatteryPlugin = {
  isIgnoringBatteryOptimizations: () => Promise<{ ignoring?: boolean }>;
  requestIgnoreBatteryOptimizations: () => Promise<{
    ignoring?: boolean;
    prompted?: boolean;
    unavailable?: boolean;
  }>;
};

const HeadlessTrack = registerPlugin<BatteryPlugin>("HeadlessTrack");

export type BatteryPromptResult = "already" | "prompted" | "unavailable";

/** Map the native dialog result. Missing method on older AABs is unavailable. */
export function batteryPromptResult(raw: {
  ignoring?: boolean;
  prompted?: boolean;
  unavailable?: boolean;
} | null | undefined): BatteryPromptResult {
  if (raw?.ignoring) return "already";
  if (raw?.unavailable || !raw?.prompted) return "unavailable";
  return "prompted";
}

function canAskAndroidBattery(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android" && Capacitor.isPluginAvailable("HeadlessTrack");
}

export async function batteryOptimizationStatus(): Promise<"ignoring" | "restricted" | "unavailable"> {
  if (!canAskAndroidBattery()) return "unavailable";
  try {
    const r = await HeadlessTrack.isIgnoringBatteryOptimizations();
    return r?.ignoring ? "ignoring" : "restricted";
  } catch {
    return "unavailable";
  }
}

export async function requestBatteryUnrestricted(): Promise<BatteryPromptResult> {
  if (!canAskAndroidBattery()) return "unavailable";
  try {
    const r = await HeadlessTrack.requestIgnoreBatteryOptimizations();
    return batteryPromptResult(r);
  } catch {
    return "unavailable";
  }
}
