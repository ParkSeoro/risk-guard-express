import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  saveMessengerLockConfig,
  setMessengerLocked,
  subscribeMessengerLockSync,
  type MessengerLockState,
} from "@/lib/messengerLock";

describe("messenger screen lock global enforcement", () => {
  it("uses fixed full-viewport z-[1000] overlay and mounts globally in AppLayout to block sidebar bypass", () => {
    const overlaySrc = readFileSync("src/components/messenger/MessengerLockOverlay.tsx", "utf8");
    const layoutSrc = readFileSync("src/components/AppLayout.tsx", "utf8");

    expect(overlaySrc).toContain("fixed inset-0 z-[1000]");
    expect(overlaySrc).not.toContain("absolute inset-0 z-50");
    expect(layoutSrc).toContain("useMessengerLock");
    expect(layoutSrc).toContain("MessengerLockScreen");
  });

  it("synchronizes lock/unlock state across components in the same tab", async () => {
    const received: MessengerLockState[] = [];
    const uid = "test-user-same-tab-sync";
    const unsub = subscribeMessengerLockSync(uid, (next) => received.push(next));

    await saveMessengerLockConfig(uid, { pin: "1234", timeoutMinutes: 5, lockNow: false });
    setMessengerLocked(uid, true);
    setMessengerLocked(uid, false);
    unsub();

    expect(received.length).toBeGreaterThanOrEqual(3);
    expect(received[received.length - 2]?.locked).toBe(true);
    expect(received[received.length - 1]?.locked).toBe(false);
  });
});
