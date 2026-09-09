import { AlertTriangle, X } from "lucide-react";
import { formatApproachDistance } from "@/lib/tracking/zoneProximity";

type Props = {
  zoneName: string;
  distanceM: number;
  accuracyM?: number | null;
  onDismiss: () => void;
};

/** Soft approach warning — no siren, no TTS. */
export default function ZoneApproachBanner({
  zoneName,
  distanceM,
  accuracyM,
  onDismiss,
}: Props) {
  const dist = formatApproachDistance(distanceM, accuracyM);
  return (
    <div
      role="status"
      data-testid="zone-approach-banner"
      className="fixed left-2 right-2 z-[28] top-[calc(var(--sat)+3.35rem)] flex items-start gap-2 rounded-lg border border-amber-400/80 bg-amber-50 px-3 py-2 text-amber-950 shadow-md"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
      <div className="min-w-0 flex-1 text-xs leading-snug">
        <div className="font-semibold">위험구역 접근</div>
        <div className="truncate">
          {zoneName}
          <span className="text-amber-800"> · {dist}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md p-1 text-amber-800 hover:bg-amber-100"
        aria-label="접근 경고 닫기"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
