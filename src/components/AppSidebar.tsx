import { 
  LayoutDashboard, FolderKanban, ShieldAlert, Database, 
  FileCheck, HardHat, ChevronLeft, LogOut, User,
  Shield, SearchCheck, Settings,
  FileText, Scale, ListTodo, Bot, CloudSun, ReceiptText, FileSignature, ClipboardList, SearchX, QrCode,
  ClipboardCheck, History, ChevronDown, Beaker, Activity, FlaskConical, GitCompare, Trash2,
  Stethoscope, GraduationCap, HeartPulse, Map, Users, AlertOctagon, Siren, OctagonAlert, UserCheck, BarChart3, Megaphone,
  Building2, FolderOpen,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";

import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { usePendingApprovalsCount } from "@/hooks/usePendingApprovalsCount";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";

type Item = { title: string; url: string; icon: any; badgeKey?: 'approvals' };
type Group = { label: string; key: string; items: Item[] };

const groups: Group[] = [
  {
    label: "핵심", key: "priority",
    items: [
      { title: "전자결재", url: "/approvals", icon: FileCheck, badgeKey: 'approvals' },
      { title: "위험성평가", url: "/risk-assessment", icon: ShieldAlert },
      { title: "작업허가서", url: "/work-permits", icon: FileSignature },
      { title: "대시보드", url: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "현장", key: "field",
    items: [
      { title: "작업계획서", url: "/work-plans", icon: FileText },
      { title: "TBM 일지", url: "/tbm-logs", icon: QrCode },
      { title: "현장 적용 체크", url: "/site-readiness", icon: ClipboardList },
    ],
  },
  {
    label: "위험/검증", key: "risk",
    items: [
      { title: "검증센터", url: "/verification-center", icon: SearchCheck },
      { title: "AI 어시스턴트", url: "/ai-assistant", icon: Bot },
      { title: "위험성평가 공지", url: "/assessment-notices", icon: Megaphone },
    ],
  },
  {
    label: "점검/사고", key: "inspect_incident",
    items: [
      { title: "안전점검", url: "/safety-inspections", icon: ClipboardCheck },
      { title: "감독 대응(점검모드)", url: "/inspection-mode", icon: SearchX },
      { title: "사고 관리", url: "/incidents", icon: AlertOctagon },
      { title: "비상대피훈련", url: "/emergency-drills", icon: Siren },
      { title: "작업중지권", url: "/work-stop", icon: OctagonAlert },
    ],
  },
  {
    label: "사람", key: "people",
    items: [
      { title: "근로자 명부", url: "/workers", icon: HardHat },
      { title: "입퇴장 현황", url: "/workers?tab=attendance", icon: ClipboardList },
      { title: "근로자별 일일 QR", url: "/workers?tab=daily-qr", icon: QrCode },
      { title: "시공사 게시판 QR", url: "/workers?tab=company-qr", icon: QrCode },
      { title: "안전보건교육 이수", url: "/worker-education", icon: GraduationCap },
      { title: "교육자료", url: "/education-materials", icon: FileText },
      { title: "공개 자료실", url: "/project-library", icon: FolderOpen },
      { title: "안전관리자 선임", url: "/safety-appointments", icon: UserCheck },
      { title: "통합 현장 관제맵", url: "/site-control-map", icon: Map },
      { title: "구역 출입 모니터링", url: "/zone-events", icon: ShieldAlert },
      { title: "근로자 분포", url: "/worker-distribution", icon: Users },
      { title: "위치 추적 점검", url: "/admin/tracking-health", icon: Users },
    ],
  },
  {
    label: "운영", key: "ops",
    items: [
      { title: "할 일", url: "/todo", icon: ListTodo },
      { title: "프로젝트", url: "/projects", icon: FolderKanban },
      { title: "현장 일기예보", url: "/site-weather", icon: CloudSun },
      { title: "회사 관리", url: "/companies", icon: Building2 },
      { title: "산업안전보건관리비", url: "/safety-cost", icon: ReceiptText },
      { title: "산안비 검증", url: "/safety-cost-validation", icon: ShieldAlert },
      { title: "법적업무", url: "/legal-duties", icon: Scale },
      { title: "협력사 안전성적표", url: "/contractor-scorecard", icon: BarChart3 },
    ],
  },
  {
    label: "보건", key: "health",
    items: [
      { title: "보건 대시보드", url: "/health", icon: HeartPulse },
      { title: "건강진단", url: "/health/checkups", icon: Stethoscope },
      { title: "작업환경측정", url: "/health/measurements", icon: ClipboardList },
      { title: "화학물질/MSDS", url: "/health/chemicals", icon: FlaskConical },
      { title: "보건교육", url: "/health/education", icon: GraduationCap },
      { title: "유해요인조사", url: "/health/hazard-surveys", icon: ClipboardList },
    ],
  },
];

const adminItems: Item[] = [
  { title: "기준정보", url: "/master-data", icon: Database },
  { title: "감사 로그", url: "/audit-logs", icon: History },
  { title: "권한 점검", url: "/permission-test", icon: Shield },
  { title: "사용 설명서", url: "/manual", icon: FileText },
  { title: "설정", url: "/settings", icon: Settings },
];

const masterOnlyItems: Item[] = [
 { title: "일관성 감사", url: "/admin/consistency-audit", icon: GitCompare },
 { title: "데이터 정합성 (SSOT)", url: "/admin/data-audit", icon: Database },
 { title: "휴지통", url: "/admin/trash", icon: Trash2 },
  { title: "AI 테스트 엔진", url: "/admin/ai-test", icon: Beaker },
  { title: "AI 로그", url: "/admin/ai-logs", icon: Activity },
  { title: "시스템 테스트 엔진", url: "/admin/system-test", icon: FlaskConical },
];

export function AppSidebar() {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const { profile, signOut, hasRole, roles } = useAuth();
  const access = useGlobalProjectAccessOptional();
  const isMaster = hasRole('master');
  const isContractorCo = !!access && !access.isMaster &&
    (access.userCompanyType === 'contractor' || access.userCompanyType === 'vendor');
  // Low-privilege = only contractor/worker/viewer/user roles (no admin/manager role)
  const LOW = new Set(['contractor', 'worker', 'viewer', 'user']);
  const isLowPriv = !isMaster && (roles.length === 0 || roles.every((r) => LOW.has(r as string)));
  const restrictToContractorUI = isContractorCo || isLowPriv;
  const location = useLocation();
  const pendingApprovals = usePendingApprovalsCount();

  const adminFinal = isMaster ? [...adminItems, ...masterOnlyItems] : adminItems;

  // 협력사/근로자(Foolproof UI): 복잡한 통계·설정·비용·법적·시스템 메뉴 완전 숨김
  const CONTRACTOR_GROUP_KEYS = new Set(['priority', 'field', 'risk', 'inspect_incident', 'people']);
  const CONTRACTOR_ALLOWED_URLS = new Set<string>([
    '/', '/approvals',
    '/work-plans', '/work-permits', '/tbm-logs',
    '/risk-assessment', '/ai-assistant', '/verification-center',
    '/incidents', '/work-stop',
    '/workers', '/workers?tab=attendance',
    '/project-library', '/education-materials', '/worker-education',
    '/profile', '/settings/account', '/manual',
  ]);
  const visibleGroups = restrictToContractorUI
    ? groups
        .filter((g) => CONTRACTOR_GROUP_KEYS.has(g.key))
        .map((g) => ({ ...g, items: g.items.filter((i) => CONTRACTOR_ALLOWED_URLS.has(i.url)) }))
        .filter((g) => g.items.length > 0)
    : groups;

  const DEFAULT_OPEN = { priority: true, field: true, risk: true, inspect_incident: true, people: true, ops: true, health: true, admin: false };
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem('sidebar:groups') || JSON.stringify(DEFAULT_OPEN)); }
    catch { return DEFAULT_OPEN; }
  });
  useEffect(() => {
    localStorage.setItem('sidebar:groups', JSON.stringify(openGroups));
  }, [openGroups]);

  const toggleGroup = (k: string) => setOpenGroups(s => ({ ...s, [k]: !s[k] }));

  // Resolve active state honoring query string (so /workers, /workers?tab=attendance,
  // and /workers?tab=daily-qr are distinct active items).
  const isItemActive = (url: string) => {
    const [pathPart, queryPart = ''] = url.split('?');
    if (pathPart === '/') return location.pathname === '/';
    if (location.pathname !== pathPart) return false;
    const itemParams = new URLSearchParams(queryPart);
    const currentParams = new URLSearchParams(location.search);
    const itemTab = itemParams.get('tab');
    const currentTab = currentParams.get('tab');
    // If this nav item specifies a tab, require exact match.
    if (itemTab) return currentTab === itemTab;
    // Item has no tab → only active when current URL also has no tab.
    return !currentTab;
  };

  const renderItem = (item: Item) => {
    const active = isItemActive(item.url);
    return (
      <SidebarMenuItem key={item.url}>
        <SidebarMenuButton asChild isActive={active}>
          <NavLink
            to={item.url}
            end={item.url === "/"}
            className={`hover:bg-sidebar-accent/80 rounded-md transition-colors ${active ? 'bg-sidebar-accent text-sidebar-primary font-semibold' : ''}`}
            onClick={() => {
              try {
                const recent = JSON.parse(localStorage.getItem('sidebar:recent') || '[]');
                const next = [item.url, ...recent.filter((u: string) => u !== item.url)].slice(0, 5);
                localStorage.setItem('sidebar:recent', JSON.stringify(next));
              } catch {}
            }}
          >
            <item.icon className="mr-2 h-4 w-4 shrink-0" />
            {!collapsed && <span className="flex-1">{item.title}</span>}
            {item.badgeKey === 'approvals' && pendingApprovals > 0 && (
              <span
                className="ml-auto inline-flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold min-w-[18px] h-[18px] px-1"
                aria-label={`결재 대기 ${pendingApprovals}건`}
                title={`결재 대기 ${pendingApprovals}건`}
              >
                {pendingApprovals > 99 ? '99+' : pendingApprovals}
              </span>
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };


  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link to="/" className="flex items-center gap-3 rounded-md outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-sidebar-ring">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary">
            <HardHat className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span className="text-sm font-bold text-sidebar-foreground">안전관리시스템</span>
              <span className="text-[10px] text-sidebar-muted">Safety Management System</span>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-2">
        {visibleGroups.map(g => (
          <SidebarGroup key={g.key} className="pb-2">
            {!collapsed ? (
              <Collapsible open={openGroups[g.key] ?? true} onOpenChange={() => toggleGroup(g.key)}>
                <CollapsibleTrigger className="w-full">
                  <SidebarGroupLabel className="text-sidebar-primary text-base font-bold tracking-tight flex items-center justify-between cursor-pointer hover:text-sidebar-foreground py-2 h-auto">
                    <span>{g.label}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${openGroups[g.key] === false ? '-rotate-90' : ''}`} />
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>{g.items.map(renderItem)}</SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <SidebarGroupContent>
                <SidebarMenu>{g.items.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        ))}

        {!restrictToContractorUI && (
          <SidebarGroup className="pb-2">
            {!collapsed ? (
              <Collapsible open={openGroups['admin'] ?? false} onOpenChange={() => toggleGroup('admin')}>
                <CollapsibleTrigger className="w-full">
                  <SidebarGroupLabel className="text-sidebar-primary text-base font-bold tracking-tight flex items-center justify-between cursor-pointer hover:text-sidebar-foreground py-2 h-auto">
                    <span>시스템</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${openGroups['admin'] === false ? '-rotate-90' : ''}`} />
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu>{adminFinal.map(renderItem)}</SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <SidebarGroupContent>
                <SidebarMenu>{adminFinal.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 space-y-1">
        {!collapsed && profile && (
          <NavLink to="/settings/account" className="flex items-center gap-2 px-2 py-1 text-xs text-sidebar-foreground hover:bg-sidebar-accent rounded-md" activeClassName="bg-sidebar-accent font-semibold">
            <User className="h-3.5 w-3.5" />
            <span className="truncate">{profile.display_name}</span>
          </NavLink>
        )}
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={toggleSidebar} className="flex-1 justify-center text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent">
            <ChevronLeft className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
          </Button>
          {!collapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="flex-1 justify-start gap-1.5 text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
              title="로그아웃"
            >
              <LogOut className="h-4 w-4" />
              <span className="text-xs">로그아웃</span>
            </Button>
          )}
          {collapsed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void signOut()}
              className="flex-1 justify-center text-sidebar-muted hover:text-sidebar-foreground hover:bg-sidebar-accent"
              title="로그아웃"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
