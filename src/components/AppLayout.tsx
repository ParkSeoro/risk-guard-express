import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { User, LogOut, Building2 } from "lucide-react";
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

  const ROLE_LABEL: Record<string, string> = {
    master: '마스터', project_admin: '프로젝트관리자', safety_manager: '안전관리자',
    site_manager: '현장소장', supervisor: '감리', worker: '작업자', viewer: '열람자',
    contractor: '협력사', // legacy
  };
  // Prefer current project role (new model); fall back to global role.
  const effectiveRole = projectAccess.userRole || (roles[0] || '');
  const roleLabel = ROLE_LABEL[effectiveRole] || effectiveRole || '역할 미지정';

  const currentProject = projectAccess.projects.find(p => p.id === projectAccess.selectedProject);

  return (
    <ProjectAccessContext.Provider value={projectAccess}>
      <SidebarProvider>
        <div className="min-h-screen flex w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="h-14 flex items-center justify-between border-b bg-card px-4 shrink-0 print:hidden">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-muted-foreground" />
                {/* Global Project Selector */}
                {projectAccess.projects.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Select value={projectAccess.selectedProject} onValueChange={projectAccess.setSelectedProject}>
                      <SelectTrigger className="w-52 h-8 text-xs border-dashed">
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
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-secondary">
                  <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div className="text-xs">
                    <p className="font-medium">{profile?.display_name || '사용자'}</p>
                    <p className="text-muted-foreground">{roleLabel}</p>
                  </div>
                </div>
                <AICreditBanner />
                <NotificationBell />
                <HelpButton className="text-muted-foreground" />
                <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={signOut}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </header>
            <TutorialOverlay />
            <main className="flex-1 overflow-auto p-6 bg-background">
              <AppErrorBoundary>{children}</AppErrorBoundary>
            </main>

          </div>
        </div>
      </SidebarProvider>
    </ProjectAccessContext.Provider>
  );
}
