import { 
  LayoutDashboard, FolderKanban, ShieldAlert, Database, 
  FileCheck, HardHat, ChevronLeft, LogOut, User,
  ShieldCheck, History, ClipboardList, Upload
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const mainItems = [
  { title: "대시보드", url: "/", icon: LayoutDashboard },
  { title: "프로젝트", url: "/projects", icon: FolderKanban },
  { title: "위험성평가", url: "/risk-assessment", icon: ShieldAlert },
  { title: "적정성 검증", url: "/verification", icon: ShieldCheck },
  { title: "결재함", url: "/approvals", icon: FileCheck },
  { title: "TBM 기록", url: "/tbm", icon: ClipboardList },
];

const adminItems = [
  { title: "기준정보", url: "/master-data", icon: Database },
  { title: "감사 로그", url: "/audit-logs", icon: History },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const { profile, signOut, isAdmin } = useAuth();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary">
            <HardHat className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-sidebar-foreground">위험성평가</span>
              <span className="text-[10px] text-sidebar-muted">Risk Assessment System</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-muted text-[10px] uppercase tracking-widest">메뉴</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end={item.url === "/"} className="hover:bg-sidebar-accent/80 rounded-md transition-colors" activeClassName="bg-sidebar-accent text-sidebar-primary font-semibold">
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-muted text-[10px] uppercase tracking-widest">관리</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} className="hover:bg-sidebar-accent/80 rounded-md transition-colors" activeClassName="bg-sidebar-accent text-sidebar-primary font-semibold">
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 space-y-1">
        {!collapsed && profile && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-sidebar-foreground">
            <User className="h-3.5 w-3.5" />
            <span className="truncate">{profile.display_name}</span>
          </div>
        )}
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={toggleSidebar} className="flex-1 justify-center text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent">
            <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          </Button>
          {!collapsed && (
            <Button variant="ghost" size="sm" onClick={signOut} className="text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent">
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
