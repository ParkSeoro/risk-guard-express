import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { User, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { NotificationBell } from "@/components/NotificationBell";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { profile, signOut, roles } = useAuth();

  const roleLabel = roles.length > 0 ? roles.map(r => {
    const map: Record<string, string> = { master: '마스터', project_admin: '관리자', safety_manager: '안전관리자', contractor: '협력사', viewer: '열람자' };
    return map[r] || r;
  }).join(', ') : '역할 미지정';

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b bg-card px-4 shrink-0 print:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="text-muted-foreground" />
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
              <NotificationBell />
              <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6 bg-background">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
