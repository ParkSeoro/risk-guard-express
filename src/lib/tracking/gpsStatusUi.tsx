import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type GpsBlockReason =
  | "no_consent"
  | "no_permission"
  | "no_checkin"
  | "fence_probe_failed"
  | "identity_mismatch"
  | null;

export type GpsQuality = "good" | "fair" | "poor" | "unknown";

export type GpsUiState = {
  tracking: boolean;
  block: GpsBlockReason;
  accuracyM?: number | null;
};

export const GPS_BLOCK_CHIP: Record<Exclude<GpsBlockReason, null>, string> = {
  no_consent: "GPS 꺼짐",
  no_permission: "GPS 권한",
  no_checkin: "GPS 출근 전",
  fence_probe_failed: "GPS 현장 밖",
  identity_mismatch: "GPS 신원",
};

export const GPS_BLOCK_HINT: Record<Exclude<GpsBlockReason, null>, string> = {
  no_consent: "위치 동의가 필요합니다",
  no_permission: "위치는 「항상 허용」·정확한 위치",
  no_checkin: "출근 후 추적이 시작됩니다",
  fence_probe_failed: "현장 밖 · 복귀하면 자동 재개",
  identity_mismatch: "명부와 계정이 다릅니다. 관리자에게 문의하세요",
};

const DEFAULT: GpsUiState = { tracking: false, block: null, accuracyM: null };

export function gpsQualityOf(accuracyM?: number | null): GpsQuality {
  if (accuracyM == null || !Number.isFinite(Number(accuracyM))) return "unknown";
  const acc = Number(accuracyM);
  if (acc <= 20) return "good";
  if (acc <= 40) return "fair";
  return "poor";
}

export const GPS_QUALITY_CHIP: Record<GpsQuality, string> = {
  good: "GPS 양호",
  fair: "GPS 보통",
  poor: "GPS 약함",
  unknown: "GPS 현장",
};

export const GPS_QUALITY_HINT: Record<GpsQuality, string> = {
  good: "위치 오차 약 20m 이내",
  fair: "위치 오차 약 40m 이내 · 접근 경고는 「근처」로 표시될 수 있음",
  poor: "건물·철골 근처에서는 위치가 수십 미터 틀릴 수 있음",
  unknown:
    "출근 후 Android는 화면을 꺼도 3분 간격으로 위치를 올립니다. 아이폰은 위치를 '항상'으로 두세요. 브라우저는 앱을 켠 동안만 추적됩니다.",
};

const GpsUiContext = createContext<GpsUiState>(DEFAULT);
const GpsUiSetContext = createContext<(next: GpsUiState) => void>(() => {});

export function GpsUiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GpsUiState>(DEFAULT);
  const value = useMemo(() => state, [state.tracking, state.block, state.accuracyM]);
  return (
    <GpsUiSetContext.Provider value={setState}>
      <GpsUiContext.Provider value={value}>{children}</GpsUiContext.Provider>
    </GpsUiSetContext.Provider>
  );
}

export function useGpsUi(): GpsUiState {
  return useContext(GpsUiContext);
}

export function useSetGpsUi(): (next: GpsUiState) => void {
  return useContext(GpsUiSetContext);
}

/** Compact header chip — not a floating overlay. */
export function GpsStatusChip({
  tracking,
  block,
  accuracyM,
}: {
  tracking: boolean;
  block: GpsBlockReason;
  accuracyM?: number | null;
}) {
  if (block === "identity_mismatch") {
    return (
      <span
        className="shrink-0 rounded-full bg-amber-300/90 text-amber-950 px-2 py-0.5 text-[10px] font-semibold leading-tight"
        data-testid="gps-block-reason"
        data-gps-block={block}
        title={GPS_BLOCK_HINT[block]}
        role="status"
      >
        {GPS_BLOCK_CHIP[block]}
      </span>
    );
  }
  if (tracking) {
    const quality = gpsQualityOf(accuracyM);
    const tone =
      quality === "poor"
        ? "bg-amber-400/90 text-amber-950"
        : quality === "fair"
          ? "bg-lime-300/80 text-lime-950"
          : "bg-emerald-400/25 text-primary-foreground";
    return (
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${tone}`}
        data-testid="gps-tracking-on"
        data-gps="on"
        data-gps-quality={quality}
        title={GPS_QUALITY_HINT[quality]}
        role="status"
      >
        {GPS_QUALITY_CHIP[quality]}
      </span>
    );
  }
  if (!block) return null;
  return (
    <span
      className="shrink-0 rounded-full bg-amber-300/90 text-amber-950 px-2 py-0.5 text-[10px] font-semibold leading-tight"
      data-testid="gps-block-reason"
      data-gps-block={block}
      title={GPS_BLOCK_HINT[block]}
      role="status"
    >
      {GPS_BLOCK_CHIP[block]}
    </span>
  );
}
