import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type GpsBlockReason =
  | "no_consent"
  | "no_permission"
  | "no_checkin"
  | "fence_probe_failed"
  | "identity_mismatch"
  | null;

export type GpsUiState = {
  tracking: boolean;
  block: GpsBlockReason;
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
  no_permission: "앱 위치 권한을 완료하세요",
  no_checkin: "출근 후 추적이 시작됩니다",
  fence_probe_failed: "현장 밖 · 복귀하면 자동 재개",
  identity_mismatch: "명부와 계정이 다릅니다. 관리자에게 문의하세요",
};

const DEFAULT: GpsUiState = { tracking: false, block: null };

const GpsUiContext = createContext<GpsUiState>(DEFAULT);
const GpsUiSetContext = createContext<(next: GpsUiState) => void>(() => {});

export function GpsUiProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GpsUiState>(DEFAULT);
  const value = useMemo(() => state, [state.tracking, state.block]);
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
}: {
  tracking: boolean;
  block: GpsBlockReason;
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
    return (
      <span
        className="shrink-0 rounded-full bg-emerald-400/25 text-primary-foreground px-2 py-0.5 text-[10px] font-semibold leading-tight"
        data-testid="gps-tracking-on"
        data-gps="on"
        title="홈으로 나가도 유지됩니다. 최근 목록에서 앱을 지우면 알람이 멈춥니다."
        role="status"
      >
        GPS 현장
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
