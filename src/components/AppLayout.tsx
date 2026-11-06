import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { DesktopRailSidebar } from "@/components/desktop/DesktopRailSidebar";
import { ArrowLeft, User, LogOut, Building2, Smartphone, Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { adminBackTarget } from "@/lib/adminBack";
import { resolveAdminApprovalsReturnPath } from "@/lib/approvalInboxPreview";
import { NotificationBell } from "@/components/NotificationBell";
import { MessengerButton } from "@/components/messenger/MessengerButton";
import { HelpButton } from "@/components/HelpButton";
import { TutorialOverlay } from "@/components/TutorialOverlay";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { AICreditBanner } from "@/components/AICreditBanner";
import ShellAssessmentShareAlert from "@/components/assessment/ShellAssessmentShareAlert";
import { RemoteSupportHost, RemoteSupportBannerSlot } from "@/components/remote-support/RemoteSupportHost";
import { RemoteSupportButton } from "@/components/remote-support/RemoteSupportButton";
import { RemoteSupportAgentPendingBadge } from "@/components/remote-support/AgentPendingBadge";

import { useProjectAccess } from "@/hooks/useProjectAccess";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createContext, useContext, useEffect } from "react";
import type { ProjectAccess } from "@/hooks/useProjectAccess";
import { isForceDesktop, isLikelyPhoneDevice, setForceDesktop } from "@/hooks/use-mobile";
import { isPureWorkerUser, MOBILE_ADMIN_HOME } from "@/components/AuthGuard";
import {
  isDesktopShellActive,
  openSafeNexWebSite,
  resizeDesktopWindow,
  resolveDesktopRouteWindowSize,
  setDesktopShellActive,
} from "@/lib/desktopBridge";

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
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isPopoutWindow = searchParams.get("popout") === "1";
  const isMessenger =
    location.pathname.includes("/messenger") ||
    location.pathname.includes("/desktop-workspace");
  const isDesktopWorkspace = location.pathname.includes("/desktop-workspace");
  const isDesktopShell = !isPopoutWindow && (isDesktopWorkspace || isDesktopShellActive());
  const navigate = useNavigate();
  const structuralBack = adminBackTarget(location.pathname);
  const backTarget = structuralBack
    ? resolveAdminApprovalsReturnPath(new URLSearchParams(location.search).get("from")) || structuralBack
    : null;

  useEffect(() => {
    if (!isDesktopShell) return;
    const { width, height } = resolveDesktopRouteWindowSize(location.pathname);
    resizeDesktopWindow(width, height);
  }, [isDesktopShell, location.pathname]);

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

  // PC 통합 워크스페이스 셸:
  // - 좌측: 메신저 모드에서는 마우스 오버 시 열리는 아이콘 레일(54px→168px), 업무 모드에서는 아이콘+메뉴명 고정(168px)
  // - 우측: 대화상대/대화목록 선택 시에는 메신저 표시(창 크기 420×680),
  //         알림 이하 업무 메뉴 선택 시에는 메신저가 빠지고 해당 기능 화면이 같은 창(1260×820 단일 사이즈) 안에 즉시 표시!
  if (isDesktopShell) {
    return (
      <ProjectAccessContext.Provider value={projectAccess}>
        <RemoteSupportHost>
          <div className="h-dvh w-full overflow-hidden bg-background flex print:block print:h-auto print:overflow-visible">
            <div className="print:hidden h-full flex shrink-0">
              <DesktopRailSidebar />
            </div>
            <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden print:block print:h-auto print:overflow-visible">
              {!isDesktopWorkspace && (
                <header className="h-11 flex items-center justify-between gap-3 border-b bg-card px-4 shrink-0 print:hidden">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {backTarget && backTarget !== "/app/admin" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="뒤로"
                        onClick={() => navigate(backTarget)}
                      >
                        <ArrowLeft className="h-4 w-4" />
                      </Button>
                    )}
                    {projectAccess.projects.length > 0 && (
                      <div className="flex items-center gap-1.5 min-w-0 max-w-xs">
                        <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                        <Select
                          value={projectAccess.selectedProject}
                          onValueChange={projectAccess.setSelectedProject}
                        >
                          <SelectTrigger className="h-7 text-xs font-semibold bg-muted/50 border-0 min-w-[160px] max-w-[260px] truncate shadow-none">
                            <SelectValue placeholder="현장 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {projectAccess.projects.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0 pr-1 text-xs text-muted-foreground whitespace-nowrap">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-[11px] gap-1.5 font-semibold text-primary border-primary/30 hover:bg-primary/10"
                      onClick={() => openSafeNexWebSite(location.pathname, location.search)}
                      title="현재 화면을 기본 웹 브라우저(전체 사이트)로 열기"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span>사이트 바로가기</span>
                      <ExternalLink className="h-3 w-3 opacity-70" />
                    </Button>
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-foreground">
                        {profile?.display_name || "관리자"}
                      </span>
                      <span>({roleLabel})</span>
                    </div>
                  </div>
                </header>
              )}
              <main
                className={
                  isDesktopWorkspace || location.pathname.includes("/messenger")
                    ? "flex-1 min-h-0 flex flex-col overflow-hidden"
                    : "flex-1 min-h-0 overflow-auto p-3.5 sm:p-4 print:block print:p-0 print:overflow-visible"
                }
              >
                <AppErrorBoundary>{children}</AppErrorBoundary>
              </main>
            </div>
          </div>
        </RemoteSupportHost>
      </ProjectAccessContext.Provider>
    );
  }

  // 미니 메신저에서 아이콘을 눌러 띄운 독립 팝업 창(?popout=1):
  // 왼쪽 웹 사이드바(AppSidebar) 없이 깔끔한 상단 현장 선택 바 + 해당 업무 페이지(기존 권한/업체 필터 100% 동일)만 표시!
  if (isPopoutWindow) {
    return (
      <ProjectAccessContext.Provider value={projectAccess}>
        <RemoteSupportHost>
          <div className="min-h-screen flex flex-col w-full bg-background print:block">
            <header className="h-12 flex items-center justify-between gap-2 border-b bg-slate-900 text-slate-100 px-3 shrink-0 print:hidden">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="h-6 w-6 rounded-md bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center shrink-0">
                  S
                </span>
                {backTarget && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-slate-300 hover:text-white hover:bg-slate-800"
                    aria-label="뒤로"
                    onClick={() => navigate(`${backTarget}${backTarget.includes("?") ? "&" : "?"}popout=1`)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
                {projectAccess.projects.length > 0 && (
                  <div className="flex items-center gap-1.5 min-w-0 max-w-xs">
                    <Building2 className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                    <Select
                      value={projectAccess.selectedProject}
                      onValueChange={projectAccess.setSelectedProject}
                    >
                      <SelectTrigger className="h-7 text-xs bg-slate-800 border-slate-700 text-slate-100 min-w-[160px]">
                        <SelectValue placeholder="현장 선택" />
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
              <div className="flex items-center gap-2 shrink-0 text-xs text-slate-300">
                <span className="font-semibold text-white">{profile?.display_name || "관리자"}</span>
                <span className="text-slate-400">({roleLabel})</span>
              </div>
            </header>
            <main
              className={`flex-1 min-h-0 bg-background w-full min-w-0 print:block print:overflow-visible print:p-0 ${
                location.pathname.includes("/messenger")
                  ? "overflow-hidden p-0 flex flex-col h-[calc(100dvh-3rem)]"
                  : "overflow-auto p-3 sm:p-5"
              }`}
            >
              <AppErrorBoundary>{children}</AppErrorBoundary>
            </main>
          </div>
        </RemoteSupportHost>
      </ProjectAccessContext.Provider>
    );
  }

  return (
    <ProjectAccessContext.Provider value={projectAccess}>
      <RemoteSupportHost>
      <SidebarProvider>
        {/* min-w-0 + overflow-x-hidden: prevent desktop-width children from forcing phone pinch-zoom layout */}
        <div className={`min-h-screen flex w-full max-w-[100vw] overflow-x-hidden print:block print:overflow-visible print:max-w-none print:h-auto ${isMessenger ? "h-dvh max-h-dvh overflow-hidden" : ""}`}>
          <AppSidebar />
          <div className={`flex-1 flex flex-col min-w-0 min-h-0 w-full max-w-full print:block print:w-full print:h-auto print:overflow-visible ${isMessenger ? "overflow-hidden" : ""}`}>
            <header className="h-14 flex items-center justify-between gap-2 border-b bg-card px-2 sm:px-4 shrink-0 print:hidden min-w-0">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <SidebarTrigger className="text-muted-foreground shrink-0" aria-label="메뉴 열기" />
                {backTarget && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    aria-label="뒤로"
                    onClick={() => navigate(backTarget)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                )}
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
                {!isPureWorkerUser(roles) && (
                  <MessengerButton currentProjectId={projectAccess.selectedProject} />
                )}
                <NotificationBell />
                <RemoteSupportAgentPendingBadge />
                <RemoteSupportButton />
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
            <RemoteSupportBannerSlot />
            <TutorialOverlay />
            <ShellAssessmentShareAlert />
            <main className={`flex-1 min-h-0 bg-background w-full min-w-0 print:block print:overflow-visible print:p-0 print:h-auto print:max-h-none ${isMessenger ? "overflow-hidden p-0 flex flex-col" : "overflow-auto overflow-x-hidden p-3 sm:p-4 md:p-6"}`}>
              <AppErrorBoundary>
                <div className={isMessenger ? "flex-1 min-h-0 flex flex-col h-full" : "w-full max-w-full min-w-0 print:block print:w-full"}>{children}</div>
              </AppErrorBoundary>
            </main>

          </div>
        </div>
      </SidebarProvider>
      </RemoteSupportHost>
    </ProjectAccessContext.Provider>
  );
}
