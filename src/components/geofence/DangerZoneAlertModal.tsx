import { useEffect } from "react";
import { DANGER_MESSAGE, speakDangerAlert, stopSpeaking } from "@/lib/tts";
import { Button } from "@/components/ui/button";
import { AlertOctagon, X } from "lucide-react";

type Props = {
  open: boolean;
  zoneName?: string | null;
  workerName?: string | null;
  onDismiss: () => void;
};

/** Full-screen red danger alert with forced TTS playback. */
export default function DangerZoneAlertModal({ open, zoneName, workerName, onDismiss }: Props) {
  useEffect(() => {
    if (!open) {
      stopSpeaking();
      return;
    }
    speakDangerAlert(DANGER_MESSAGE);
    // Repeat every 8s while open
    const id = window.setInterval(() => speakDangerAlert(DANGER_MESSAGE), 8000);
    return () => {
      window.clearInterval(id);
      stopSpeaking();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="위험 구역 진입 경고"
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-red-700 text-white p-6 animate-in fade-in duration-200"
    >
      <AlertOctagon className="h-28 w-28 mb-6 animate-pulse" strokeWidth={1.5} />
      <h1 className="text-4xl sm:text-5xl font-black text-center leading-tight mb-4">
        위험 구역 진입
      </h1>
      <p className="text-xl sm:text-2xl font-bold text-center leading-snug max-w-md mb-2">
        경고. 위험 구역에 진입했습니다.
        <br />
        즉시 이탈하십시오.
      </p>
      {zoneName && (
        <p className="text-lg text-red-100 mt-4 text-center">구역: {zoneName}</p>
      )}
      {workerName && (
        <p className="text-base text-red-200 mt-1 text-center">{workerName}</p>
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
