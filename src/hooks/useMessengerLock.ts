import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadMessengerLockState,
  setMessengerLocked,
  subscribeMessengerLockSync,
  type MessengerLockState,
} from "@/lib/messengerLock";

export function useMessengerLock(userId?: string | null) {
  const [lockState, setLockState] = useState<MessengerLockState>(() =>
    loadMessengerLockState(userId),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    setLockState(loadMessengerLockState(userId));
    if (!userId) return;
    return subscribeMessengerLockSync(userId, (next) => {
      setLockState(next);
    });
  }, [userId]);

  useEffect(() => {
    if (!userId || !lockState.pinHash || lockState.timeoutMinutes <= 0 || lockState.locked) {
      return;
    }

    lastActivityRef.current = Date.now();
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "mousemove",
      "touchstart",
      "scroll",
    ];
    events.forEach((ev) => window.addEventListener(ev, markActive, { passive: true }));

    const timeoutMs = lockState.timeoutMinutes * 60 * 1000;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= timeoutMs) {
        const next = setMessengerLocked(userId, true);
        setLockState(next);
      }
    }, 5000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActive));
      window.clearInterval(timer);
    };
  }, [userId, lockState.pinHash, lockState.timeoutMinutes, lockState.locked]);

  const lockNow = useCallback(() => {
    if (!userId) return;
    if (!lockState.pinHash) {
      setSettingsOpen(true);
      return;
    }
    setLockState(setMessengerLocked(userId, true));
  }, [userId, lockState.pinHash]);

  const unlock = useCallback(() => {
    if (!userId) return;
    lastActivityRef.current = Date.now();
    setLockState(setMessengerLocked(userId, false));
  }, [userId]);

  return {
    lockState,
    setLockState,
    settingsOpen,
    setSettingsOpen,
    lockNow,
    unlock,
    isLockConfigured: Boolean(lockState.pinHash),
  };
}
