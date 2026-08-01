import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import type { MobileRole } from "@/hooks/useMobileAccess";
import {
  notifyPreviewWriteBlocked,
  parsePreviewMode,
  resolveMobilePreviewSession,
  type MobilePreviewSession,
  type PreviewMode,
  PREVIEW_MODES,
} from "@/lib/mobilePreview";

export type { PreviewMode };

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
    case "site_supervisor":
      return "site_supervisor";
    case "site_manager":
      return "site_manager";
    case "project_admin":
      return "project_admin";
    case "safety_manager":
      return "safety_manager";
    case "master":
      return "master";
    default:
      return "worker";
  }
}

function sessionToValue(session: MobilePreviewSession): PreviewContextValue {
  const mode = parsePreviewMode(session.mode);
  return {
    isPreview: true,
    previewMode: mode,
    previewProjectId: session.projectId,
    readOnly: true,
    syntheticRole: previewModeToRole(mode),
  };
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
    () => sessionToValue({ mode, projectId }),
    [mode, projectId],
  );
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/**
 * Bootstrap preview from URL / iframe sessionStorage (no nested Router).
 * Mount inside BrowserRouter, typically around worker shell routes.
 */
export function MobilePreviewGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [session, setSession] = useState<MobilePreviewSession | null>(() =>
    resolveMobilePreviewSession(location.search),
  );

  useEffect(() => {
    setSession(resolveMobilePreviewSession(location.search));
  }, [location.search, location.pathname]);

  if (!session) return <>{children}</>;

  return (
    <PreviewProvider mode={session.mode} projectId={session.projectId}>
      {children}
    </PreviewProvider>
  );
}

export function usePreview() {
  return useContext(PreviewContext);
}

/** Block writes in preview — returns true if blocked (caller should return). */
export function usePreviewWriteBlock(): () => boolean {
  const { isPreview, readOnly } = usePreview();
  return () => {
    if (isPreview && readOnly) {
      notifyPreviewWriteBlocked("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return true;
    }
    return false;
  };
}

export { PREVIEW_MODES };
