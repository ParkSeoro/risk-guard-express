import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { User, LogOut, Building2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";
import { HelpButton } from "@/components/HelpButton";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AICreditBanner } from "@/components/AICreditBanner";

import { useProjectAccess } from "@/hooks/useProjectAccess";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createContext, useContext } from "react";
import type { ProjectAccess } from "@/hooks/useProjectAccess";
import { isForceDesktop, isLikelyPhoneDevice, setForceDesktop } from "@/hooks/use-mobile";
import { MOBILE_ADMIN_HOME } from "@/components/AuthGuard";

export const ProjectAccessContext = createContext<ProjectAccess | null>(null);
export const useGlobalProjectAccess = () => {
  const ctx = useContext(ProjectAccessContext);
  if (!ctx) throw new Error("useGlobalProjectAccess must be used within AppLayout");
  return ctx;
};
/** Null-safe variant for hooks/components that may render outside AppLayout. */
export const useGlobalProjectAccessOptional = () => useContext(ProjectAccessContext);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut, roles } = useAuth();
  const projectAccess = useProjectAccess();
  const showBackToMobile = isForceDesktop() && isLikelyPhoneDevice();

  const ROLE_LABEL: Record<string, string> = {
    master: '마스터', project_admin: '프로젝트관리자', safety_manager: '안전관리자',
    site_manager: '현장소장', supervisor: '감리', site_supervisor: '관리감독자',
    worker: '작업자', viewer: '열람자',
    contractor: '협력사', // legacy
  };
  // Prefer current project role (new model); fall back to global role.
  const effectiveRole = projectAccess.userRole || (roles[0] || '');
  const roleLabel = ROLE_LABEL[effectiveRole] || effectiveRole || '역할 미지정';

  const returnToMobile = () => {
    setForceDesktop(false);
    window.location.assign(MOBILE_ADMIN_HOME);
  };
  return (
    <ProjectAccessContext.Provider value={projectAccess}>
      <SidebarProvider>
        {/* min-w-0 + overflow-x-hidden: prevent desktop-width children from forcing phone pinch-zoom layout */}
        <div className="min-h-screen flex w-full max-w-[100vw] overflow-x-hidden print:block print:overflow-visible print:max-w-none print:h-auto">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 w-full max-w-full print:block print:w-full print:h-auto print:overflow-visible">
            <header className="h-14 flex items-center justify-between gap-2 border-b bg-card px-2 sm:px-4 shrink-0 print:hidden min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SidebarTrigger className="text-muted-foreground shrink-0" aria-label="메뉴 열기" />
                {/* Global Project Selector — shrinks on narrow screens */}
                {projectAccess.projects.length > 0 && (
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 max-w-[11rem] sm:max-w-[14rem] md:max-w-none md:flex-none">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0 hidden xs:block sm:block" />
                    <Select value={projectAccess.selectedProject} onValueChange={projectAccess.setSelectedProject}>
                      <SelectTrigger className="w-full sm:w-52 h-8 text-xs border-dashed min-w-0">
                        <SelectValue placeholder="프로젝트 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {projectAccess.projects.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            <div className="flex flex-col">
                              <span>{p.name}</span>
                              <span className="text-[10px] text-muted-foreground">{p.site_name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {showBackToMobile && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 px-2 text-xs border-primary/40 text-primary"
                    onClick={returnToMobile}
                    title="모바일 화면으로 돌아가기"
                  >
                    <Smartphone className="h-4 w-4" />
                    <span className="hidden sm:inline">모바일</span>
                  </Button>
                )}
                <div className="flex items-center gap-1.5 sm:gap-2 px-1.5 sm:px-2 py-1 rounded-md bg-secondary min-w-0">
                  <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="text-xs hidden sm:block min-w-0">
                    <p className="font-medium truncate max-w-[7rem] md:max-w-[10rem]">{profile?.display_name || '사용자'}</p>
                    <p className="text-muted-foreground truncate">{roleLabel}</p>
                  </div>
                </div>
                <div className="hidden md:block">
                  <AICreditBanner />
                </div>
                <NotificationBell />
                <HelpButton className="text-muted-foreground hidden sm:inline-flex" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground gap-1.5 px-2"
                  onClick={() => void signOut()}
                  title="로그아웃"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden md:inline text-xs">로그아웃</span>
                </Button>
              </div>
            </header>
            <TutorialOverlay />
            <main className="flex-1 overflow-auto overflow-x-hidden p-3 sm:p-4 md:p-6 bg-background w-full min-w-0 print:block print:overflow-visible print:p-0 print:h-auto print:max-h-none">
              <AppErrorBoundary>
                <div className="w-full max-w-full min-w-0 print:block print:w-full">{children}</div>
              </AppErrorBoundary>
            </main>

          </div>
        </div>
      </SidebarProvider>
    </ProjectAccessContext.Provider>
  );
}
