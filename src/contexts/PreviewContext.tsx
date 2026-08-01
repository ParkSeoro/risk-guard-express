import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { MobileRole } from "@/hooks/useMobileAccess";

export type PreviewMode = "worker" | "supervisor" | "site_manager" | "safety_manager" | "master";

export type PreviewContextValue = {
  isPreview: boolean;
  previewMode: PreviewMode;
  previewProjectId: string;
  readOnly: boolean;
  /** Maps previewMode → synthetic MobileRole for useMobileAccess */
  syntheticRole: MobileRole;
};

const PreviewContext = createContext<PreviewContextValue>({
  isPreview: false,
  previewMode: "worker",
  previewProjectId: "",
  readOnly: true,
  syntheticRole: "worker",
});

export function previewModeToRole(mode: PreviewMode): MobileRole {
  switch (mode) {
    case "worker":
      return "worker";
    case "supervisor":
      return "supervisor";
    case "site_manager":
      return "site_manager";
    case "safety_manager":
      return "safety_manager";
    case "master":
      return "master";
    default:
      return "worker";
  }
}

export function PreviewProvider({
  mode,
  projectId,
  children,
}: {
  mode: PreviewMode;
  projectId: string;
  children: ReactNode;
}) {
  const value = useMemo<PreviewContextValue>(
    () => ({
      isPreview: true,
      previewMode: mode,
      previewProjectId: projectId,
      readOnly: true,
      syntheticRole: previewModeToRole(mode),
    }),
    [mode, projectId],
  );
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreview() {
  return useContext(PreviewContext);
}

/** Block writes in preview — returns true if blocked (caller should return). */
export function usePreviewWriteBlock(): () => boolean {
  const { isPreview, readOnly } = usePreview();
  return () => {
    if (isPreview && readOnly) {
      try {
        // lazy import toast would create cycle; use alert-less console + custom event
        window.dispatchEvent(
          new CustomEvent("mobile-preview:blocked-write", {
            detail: { message: "프리뷰 모드에서는 데이터를 변경할 수 없습니다." },
          }),
        );
      } catch {
        /* ignore */
      }
      return true;
    }
    return false;
  };
}
