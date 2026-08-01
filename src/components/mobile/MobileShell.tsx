import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  ClipboardList,
  FileCheck2,
  FolderOpen,
  Home,
  Menu,
  OctagonAlert,
} from "lucide-react";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import {
  mobileTabsForBucket,
  resolveMobileShellBucket,
  roleLabelKo,
  MOBILE_WORK_STOP,
} from "@/lib/mobileShell";
import { usePreview } from "@/contexts/PreviewContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const ICONS: Record<string, typeof Home> = {
  today: Home,
  tasks: ClipboardList,
  approvals: FileCheck2,
  docs: FolderOpen,
  alerts: Bell,
  more: Menu,
};

export default function MobileShell({ children }: { children: ReactNode }) {
  const { role, isMaster, projectId, loading } = useMobileAccess();
  const preview = usePreview();
  const location = useLocation();
  const navigate = useNavigate();
  const bucket = resolveMobileShellBucket(
    preview.isPreview ? preview.syntheticRole : role,
    preview.isPreview ? preview.syntheticRole === "master" : isMaster,
  );
  const tabs = mobileTabsForBucket(bucket);
  const displayRole = preview.isPreview ? preview.syntheticRole : role;

  const hideChrome =
    location.pathname.includes("/approvals/") ||
    location.pathname.includes("/risk-assessment/") ||
    location.pathname.includes("/work-plans/");

  return (
    <div
      className="min-h-screen bg-muted/30 flex flex-col"
      data-testid="mobile-shell"
      data-mobile-role={displayRole}
      data-mobile-bucket={bucket}
    >
      {preview.isPreview && (
        <div className="sticky top-0 z-40 bg-amber-500 text-amber-950 text-center text-xs font-semibold py-1.5 px-2">
          프리뷰 · 데이터 변경 불가 · {roleLabelKo(displayRole)}
        </div>
      )}

      {!hideChrome && (
        <header className="sticky top-0 z-30 bg-primary text-primary-foreground px-3 py-2.5 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm leading-tight">SafeNex</div>
            <div className="text-[10px] opacity-80 truncate">
              {loading ? "역할 확인 중…" : roleLabelKo(displayRole)}
              {projectId ? "" : " · 프로젝트 미선택"}
            </div>
          </div>
          <Badge variant="secondary" className="text-[10px] shrink-0">
            {bucket === "worker" ? "근로자" : bucket === "master" ? "마스터" : "관리자"}
          </Badge>
        </header>
      )}

      <div className="flex-1 pb-28">{children}</div>

      {/* Persistent work-stop */}
      {!hideChrome && (
        <Button
          type="button"
          size="sm"
          className="fixed bottom-[4.5rem] right-3 z-30 rounded-full shadow-lg bg-destructive hover:bg-destructive/90 h-11 px-4"
          onClick={() => navigate(MOBILE_WORK_STOP)}
          data-testid="work-stop-fab"
        >
          <OctagonAlert className="h-4 w-4 mr-1.5" />
          작업중지
        </Button>
      )}

      {!hideChrome && (
        <nav
          className="fixed bottom-0 inset-x-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
          data-testid="mobile-bottom-nav"
        >
          <ul className="mx-auto max-w-md grid" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
            {tabs.map((tab) => {
              const Icon = ICONS[tab.key] || Home;
              const active =
                location.pathname === tab.path ||
                location.pathname.startsWith(tab.path + "/");
              return (
                <li key={tab.key}>
                  <NavLink
                    to={tab.path}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px]",
                      active ? "text-primary font-semibold" : "text-muted-foreground",
                    )}
                    data-testid={`tab-${tab.key}`}
                  >
                    <Icon className="h-5 w-5" />
                    {tab.label}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
