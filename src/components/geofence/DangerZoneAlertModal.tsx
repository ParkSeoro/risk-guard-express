import { useEffect, useRef } from "react";
import { playDangerAlarm, stopSpeaking, unlockAlarmAudio } from "@/lib/tts";
import type { AlarmRoleInput } from "@/lib/alarmRoleLabel";
import { buildDangerUiMessage, formatAlarmSubject } from "@/lib/alarmRoleLabel";
import { startDangerHapticsLoop } from "@/lib/alarmHaptics";
import { Button } from "@/components/ui/button";
import { AlertOctagon, X } from "lucide-react";

type Props = {
  open: boolean;
  zoneName?: string | null;
  /** Client preview waiting for track-location (S-01). */
  confirming?: boolean;
  workerName?: string | null;
  /** project_role / global role for honorific (관리자님 / 근로자 …) */
  workerRole?: AlarmRoleInput;
  onDismiss: () => void;
};

/** Full-screen red danger alert with siren → TTS + haptics. */
export default function DangerZoneAlertModal({
  open,
  zoneName,
  confirming = false,
  workerName,
  workerRole,
  onDismiss,
}: Props) {
  const playingRef = useRef(false);

  useEffect(() => {
    if (!open) {
      playingRef.current = false;
      stopSpeaking();
      return;
    }

    let cancelled = false;
    let wakeLock: { release: () => Promise<void> } | null = null;

    const runCycle = async (withTts: boolean) => {
      if (cancelled || playingRef.current) return;
      playingRef.current = true;
      try {
        await playDangerAlarm({
          displayName: workerName,
          role: workerRole,
          zoneName,
          skipSiren: false,
          skipTts: !withTts,
        });
      } finally {
        playingRef.current = false;
      }
    };

    void unlockAlarmAudio();
    void runCycle(true);
    const stopHaptics = startDangerHapticsLoop(10_000);
    let cycle = 0;
    const id = window.setInterval(() => {
      cycle += 1;
      void runCycle(cycle % 2 === 0);
    }, 12_000);

    try {
      const wl = (navigator as any)?.wakeLock;
      if (wl?.request) {
        void wl.request("screen").then((lock: any) => {
          if (cancelled) {
            void lock.release?.();
            return;
          }
          wakeLock = lock;
        });
      }
    } catch {
      /* ignore */
    }

    return () => {
      cancelled = true;
      window.clearInterval(id);
      stopHaptics();
      playingRef.current = false;
      stopSpeaking();
      void wakeLock?.release?.();
    };
  }, [open, workerName, workerRole, zoneName]);

  if (!open) return null;

  const message = buildDangerUiMessage({
    displayName: workerName,
    role: workerRole,
    zoneName,
  });
  const subjectLabel =
    workerName || workerRole ? formatAlarmSubject(workerName, workerRole) : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="위험 구역 진입 경고"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-red-700 text-white p-6 animate-in fade-in duration-200 danger-alarm-flash"
    >
      <style>{`
        @keyframes danger-alarm-flash {
          0%, 100% { background-color: rgb(185 28 28); }
          50% { background-color: rgb(127 29 29); }
        }
        .danger-alarm-flash {
          animation: danger-alarm-flash 0.7s ease-in-out infinite;
        }
        @keyframes danger-icon-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.12); opacity: 0.85; }
        }
        .danger-icon-pulse {
          animation: danger-icon-pulse 0.7s ease-in-out infinite;
        }
      `}</style>
      <AlertOctagon className="h-28 w-28 mb-6 danger-icon-pulse" strokeWidth={1.5} />
      <h1 className="text-4xl sm:text-5xl font-black text-center leading-tight mb-4">
        {confirming ? "위험 구역 확인 중" : "위험 구역 진입"}
      </h1>
      <p className="text-xl sm:text-2xl font-bold text-center leading-snug max-w-lg mb-2">
        {message}
      </p>
      {confirming && (
        <p className="text-sm text-red-100/90 mt-2 text-center">서버에서 위치를 확인하는 중입니다</p>
      )}
      {zoneName && (
        <p className="text-lg text-red-100 mt-4 text-center">구역: {zoneName}</p>
      )}
      {subjectLabel && (
        <p className="text-base text-red-200 mt-1 text-center">{subjectLabel}</p>
      )}
      <Button
        size="lg"
        variant="secondary"
        className="mt-10 h-14 px-8 text-lg font-bold bg-white text-red-700 hover:bg-red-50"
        onClick={onDismiss}
      >
        <X className="h-5 w-5 mr-2" /> 확인 · 이탈 예정
      </Button>
    </div>
  );
}
