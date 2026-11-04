import { useEffect, useState, useCallback, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { DesktopAppSettingsDialog } from "@/components/desktop/DesktopAppSettingsDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";
import { isAllowedForContractor } from "@/lib/contractorRouteAccess";
import {
  applyDesktopWindowMode,
  loadDesktopPresence,
  loadDesktopSettings,
  openDesktopPopoutWindow,
  saveDesktopPresence,
  saveDesktopSettings,
  updateDesktopTaskbarBadge,
  type DesktopPresenceStatus,
  type DesktopWindowMode,
} from "@/lib/desktopBridge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  Users,
  CheckSquare,
  Bell,
  Megaphone,
  Receipt,
  FileCheck2,
  ShieldAlert,
  ClipboardList,
  HardHat,
  MapPin,
  LayoutDashboard,
  Settings,
  Plus,
  ExternalLink,
  Pin,
  Maximize2,
  Minimize2,
  LogOut,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RailTargetId =
  | "directory"
  | "rooms"
  | "alerts"
  | "announcements"
  | "approvals"
  | "dashboard"
  | "work-permits"
  | "work-plans"
  | "risk-assessment"
  | "tbm-logs"
  | "safety-inspections"
  | "safety-cost"
  | "site-control-map";

interface RailIconItem {
  id: RailTargetId;
  label: string;
  path: string;
  icon: typeof Bell;
  group: "comm" | "popup";
  /** 팝업창 가로 크기 (화면에 알맞은 최적 사이즈) */
  popupWidth: number;
  /** 팝업창 세로 크기 */
  popupHeight: number;
  /** RoleGuard(마스터/프로젝트관리자/안전관리자 전용) 대상 여부 */
  adminOnly?: boolean;
}

const RAIL_ICONS: RailIconItem[] = [
  // ① 미니 메신저 내부 전환 탭 (대화상대 / 대화목록)
  {
    id: "directory",
    label: "대화상대 (현장 조직도)",
    path: "/app/admin/desktop-workspace",
    icon: Users,
    group: "comm",
    popupWidth: 410,
    popupHeight: 740,
  },
  {
    id: "rooms",
    label: "대화목록 (채팅)",
    path: "/app/admin/desktop-workspace",
    icon: MessageSquare,
    group: "comm",
    popupWidth: 410,
    popupHeight: 740,
  },
  // ② 클릭 시 맞춤 사이즈 독립 팝업창(Window)으로 즉시 열리는 그룹웨어 기능들
  {
    id: "alerts",
    label: "실시간 알림함",
    path: "/app/admin/alerts",
    icon: Bell,
    group: "popup",
    popupWidth: 540,
    popupHeight: 740,
  },
  {
    id: "announcements",
    label: "현장 공지사항",
    path: "/app/admin/announcements",
    icon: Megaphone,
    group: "popup",
    popupWidth: 780,
    popupHeight: 800,
  },
  {
    id: "approvals",
    label: "전자결재함",
    path: "/app/admin/approvals",
    icon: CheckSquare,
    group: "popup",
    popupWidth: 1120,
    popupHeight: 840,
  },
  {
    id: "dashboard",
    label: "오늘의 현장 대시보드",
    path: "/app/admin",
    icon: LayoutDashboard,
    group: "popup",
    popupWidth: 1280,
    popupHeight: 860,
  },
  {
    id: "work-permits",
    label: "작업허가서 (PTW) 목록",
    path: "/app/admin/work-permits",
    icon: FileCheck2,
    group: "popup",
    popupWidth: 1240,
    popupHeight: 860,
  },
  {
    id: "work-plans",
    label: "작업계획서 목록",
    path: "/app/admin/work-plans",
    icon: ClipboardList,
    group: "popup",
    popupWidth: 1240,
    popupHeight: 860,
  },
  {
    id: "risk-assessment",
    label: "위험성평가 목록",
    path: "/app/admin/risk-assessment",
    icon: ShieldAlert,
    group: "popup",
    popupWidth: 1280,
    popupHeight: 860,
  },
  {
    id: "tbm-logs",
    label: "TBM 및 일일안전점검",
    path: "/app/admin/tbm-logs",
    icon: HardHat,
    group: "popup",
    popupWidth: 1180,
    popupHeight: 840,
  },
  {
    id: "safety-inspections",
    label: "안전점검 일지",
    path: "/app/admin/safety-inspections",
    icon: ClipboardCheck,
    group: "popup",
    popupWidth: 1180,
    popupHeight: 840,
  },
  {
    id: "safety-cost",
    label: "산업안전보건관리비",
    path: "/app/admin/safety-cost",
    icon: Receipt,
    group: "popup",
    popupWidth: 1320,
    popupHeight: 880,
    adminOnly: true,
  },
  {
    id: "site-control-map",
    label: "통합 현장 관제맵",
    path: "/app/admin/site-control-map",
    icon: MapPin,
    group: "popup",
    popupWidth: 1380,
    popupHeight: 900,
  },
];

const PRESENCE_OPTIONS: {
  value: DesktopPresenceStatus;
  label: string;
  dotClass: string;
}[] = [
  { value: "online", label: "온라인", dotClass: "bg-emerald-500" },
  { value: "inspecting", label: "현장 점검중", dotClass: "bg-blue-500" },
  { value: "busy", label: "회의/바쁨", dotClass: "bg-red-500" },
  { value: "away", label: "자리비움", dotClass: "bg-amber-400" },
];

export default function DesktopWorkspacePage() {
  const { user, profile, roles, rolesReady, hasRole, signOut } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room");
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  // 카톡처럼 상단 기본 탭은 '대화상대(directory)' 또는 '대화목록(rooms)'
  const [messengerTab, setMessengerTab] = useState<"directory" | "rooms">(
    initialRoomId ? "rooms" : "directory",
  );
  const [windowMode, setWindowMode] = useState<DesktopWindowMode>(
    () => loadDesktopSettings().defaultWindowMode || "compact",
  );
  const [presence, setPresence] = useState<DesktopPresenceStatus>(() =>
    loadDesktopPresence(),
  );
  const [desktopSettings, setDesktopSettings] = useState(() =>
    loadDesktopSettings(),
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // 기존 GitHub 권한 정책(AppSidebar.tsx / RoleGuard.tsx / ContractorGate.tsx)과 100% 동일하게 적용
  const isMaster = hasRole("master");
  const isContractorCo =
    !!projectAccess &&
    !projectAccess.isMaster &&
    (projectAccess.userCompanyType === "contractor" ||
      projectAccess.userCompanyType === "vendor");
  const LOW_ROLES = useMemo(
    () => new Set(["contractor", "worker", "viewer", "user"]),
    [],
  );
  const isLowPriv =
    !isMaster && (roles.length === 0 || roles.every((r) => LOW_ROLES.has(String(r))));
  const restrictToContractorUI = isContractorCo || isLowPriv;

  // 권한에 따라 좌측 레일에 노출할 아이콘 필터링
  const visiblePopupIcons = useMemo(() => {
    return RAIL_ICONS.filter((item) => {
      if (item.group !== "popup") return false;
      // 협력사/저권한 계정은 CONTRACTOR_ALLOWED_PREFIXES(contractorRouteAccess.ts)에 허용된 경로만 표시
      // 단, 공지사항(/announcements)은 현장 공지 확인용으로 표시 허용
      if (restrictToContractorUI) {
        if (item.adminOnly) return false;
        if (item.id === "announcements") return true;
        return isAllowedForContractor(item.path);
      }
      // RoleGuard 기본 허용 역할(['master', 'project_admin', 'safety_manager'])이 필요한 메뉴(안전관리비 등)
      if (item.adminOnly) {
        return (
          isMaster ||
          hasRole("project_admin" as any) ||
          hasRole("safety_manager" as any) ||
          projectAccess?.userRole === "project_admin" ||
          projectAccess?.userRole === "safety_manager"
        );
      }
      return true;
    });
  }, [restrictToContractorUI, isMaster, hasRole, projectAccess?.userRole]);

  // 대화방 목록 로드
  const loadRooms = useCallback(async () => {
    try {
      const data = await fetchMyChatRooms();
      setRooms(data);
    } catch (err) {
      console.error("DesktopWorkspace loadRooms error:", err);
    } finally {
      setLoadingRooms(false);
    }
  }, []);

  // 미결재 건수 & 미확인 알림 건수 로드
  const loadBadges = useCallback(async () => {
    if (!user) return;
    try {
      const [{ count: approvalCount }, { count: notifCount }] = await Promise.all([
        supabase
          .from("approvals")
          .select("id", { count: "exact", head: true })
          .eq("approver_id", user.id)
          .eq("status", "pending"),
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("read", false),
      ]);
      setPendingApprovalsCount(approvalCount || 0);
      setUnreadNotificationsCount(notifCount || 0);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    void loadRooms();
    void loadBadges();
  }, [loadRooms, loadBadges]);

  // 실시간 메신저 및 결재/알림 구독
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("desktop-workspace-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_room_messages" },
        () => {
          void loadRooms();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "approvals",
          filter: `approver_id=eq.${user.id}`,
        },
        () => {
          void loadBadges();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadRooms, loadBadges]);

  const totalUnreadChats = useMemo(
    () => rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0),
    [rooms],
  );

  // 작업표시줄(Taskbar) 배지 동기화
  useEffect(() => {
    updateDesktopTaskbarBadge(totalUnreadChats + pendingApprovalsCount);
  }, [totalUnreadChats, pendingApprovalsCount]);

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    return rooms.find((r) => r.id === selectedRoomId) || null;
  }, [rooms, selectedRoomId]);

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoomId(room.id);
    setMessengerTab("rooms");
    setSearchParams({ room: room.id }, { replace: true });
  };

  const handlePopoutRoom = (room: ChatRoom) => {
    const title =
      room.custom_name ||
      room.name ||
      room.other_participant?.full_name ||
      "SafeNex 대화방";
    openDesktopPopoutWindow({
      url: `${window.location.origin}/app/admin/messenger?room=${room.id}&popout=1`,
      title: `SafeNex - ${title}`,
      width: 420,
      height: 700,
      windowName: `safenex_chat_${room.id}`,
    });
  };

  const handleToggleWindowMode = (nextMode: DesktopWindowMode) => {
    setWindowMode(nextMode);
    applyDesktopWindowMode(nextMode);
    setDesktopSettings(loadDesktopSettings());
    try {
      if (nextMode === "compact") {
        window.resizeTo(410, 740);
      } else {
        window.resizeTo(920, 760);
      }
    } catch {
      /* ignore if browser blocks resizeTo */
    }
  };

  /**
   * 좌측 아이콘 클릭 시:
   * - 대화상대(directory) / 대화목록(rooms)은 우측 미니 메신저 리스트를 전환
   * - 알림 / 공지사항 / 전자결재 / 대시보드 / 작업허가서 / 작업계획서 등은
   *   각 화면 성격에 맞춘 최적 사이즈의 독립 팝업창(?popout=1)으로 즉시 띄움!
   *   (팝업창 내부에서는 기존의 프로젝트/업체 스코프 및 발주처·마스터 검색 필터가 100% 그대로 동작)
   */
  const handleOpenPopupFeature = (item: RailIconItem) => {
    openDesktopPopoutWindow({
      url: `${window.location.origin}${item.path}`,
      title: `SafeNex - ${item.label}`,
      width: item.popupWidth,
      height: item.popupHeight,
      windowName: `safenex_popup_${item.id}`,
    });
  };

  const handleCyclePresence = () => {
    const idx = PRESENCE_OPTIONS.findIndex((o) => o.value === presence);
    const next = PRESENCE_OPTIONS[(idx + 1) % PRESENCE_OPTIONS.length];
    setPresence(next.value);
    saveDesktopPresence(next.value);
    toast.success(`근무 상태: ${next.label}`);
  };

  const currentPresenceMeta =
    PRESENCE_OPTIONS.find((o) => o.value === presence) || PRESENCE_OPTIONS[0];

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  return (
    <div className="h-dvh w-screen flex bg-background overflow-hidden select-none">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          1. 좌측 순수 아이콘 레일 (폭 54px, 카카오톡 PC 스타일 — 글자 없이 아이콘만!)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <aside className="w-[54px] bg-[#1e2229] text-slate-400 flex flex-col items-center py-3 justify-between shrink-0 z-30">
        <div className="flex flex-col items-center gap-1.5 w-full">
          {/* 내 상태 아바타 (클릭 시 온라인/점검중/자리비움 전환) */}
          <button
            type="button"
            onClick={handleCyclePresence}
            title={`내 상태: ${profile?.display_name || "관리자"} (${currentPresenceMeta.label}) — 클릭하여 상태 변경`}
            className="relative mb-2 group"
          >
            <div className="h-9 w-9 rounded-2xl bg-amber-400 text-slate-950 font-extrabold text-sm flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
              {profile?.display_name?.slice(0, 1) || "S"}
            </div>
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#1e2229]",
                currentPresenceMeta.dotClass,
              )}
            />
          </button>

          {/* 👥 대화상대 (현장 조직도) */}
          <button
            type="button"
            onClick={() => {
              setMessengerTab("directory");
              if (windowMode === "compact") setSelectedRoomId(null);
              setSearchParams({}, { replace: true });
            }}
            title="대화상대 (현장 조직도)"
            aria-label="대화상대"
            className={cn(
              "relative h-10 w-10 rounded-xl flex items-center justify-center transition-all",
              messengerTab === "directory" && (!selectedRoomId || windowMode === "expanded")
                ? "bg-white/15 text-white shadow-xs"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )}
          >
            <Users className="h-[20px] w-[20px]" />
          </button>

          {/* 💬 대화목록 (채팅) */}
          <button
            type="button"
            onClick={() => {
              setMessengerTab("rooms");
            }}
            title="대화목록 (채팅)"
            aria-label="대화목록"
            className={cn(
              "relative h-10 w-10 rounded-xl flex items-center justify-center transition-all",
              messengerTab === "rooms"
                ? "bg-white/15 text-white shadow-xs"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
            )}
          >
            <MessageSquare className="h-[20px] w-[20px]" />
            {totalUnreadChats > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ff3b30] text-white text-[9px] font-extrabold flex items-center justify-center shadow-xs">
                {totalUnreadChats > 99 ? "99+" : totalUnreadChats}
              </span>
            )}
          </button>

          <div className="w-6 h-px bg-white/10 my-1" />

          {/* 🔔 알림 / 📢 공지사항 / ✅ 전자결재 / 📊 대시보드 / 📝 작업허가서 등 (클릭 시 맞춤 사이즈 팝업창 오픈!) */}
          {visiblePopupIcons.map((item) => {
            const Icon = item.icon;
            const badge =
              item.id === "alerts"
                ? unreadNotificationsCount
                : item.id === "approvals"
                  ? pendingApprovalsCount
                  : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpenPopupFeature(item)}
                title={`${item.label} 팝업창 열기 (${item.popupWidth}×${item.popupHeight})`}
                aria-label={item.label}
                className="relative h-9 w-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-amber-400 hover:text-slate-950 transition-all"
              >
                <Icon className="h-[18px] w-[18px]" />
                {badge > 0 && (
                  <span
                    className={cn(
                      "absolute -top-0.5 -right-0.5 min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-black flex items-center justify-center border border-[#1e2229]",
                      item.id === "alerts"
                        ? "bg-[#ff3b30] text-white"
                        : "bg-amber-400 text-slate-950",
                    )}
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 하단: 항상 위 고정 / 채팅창 좌우 펼치기 / 설정 / 로그아웃 */}
        <div className="flex flex-col items-center gap-1 w-full pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={() => {
              const next = !desktopSettings.alwaysOnTop;
              const updated = saveDesktopSettings({ alwaysOnTop: next });
              setDesktopSettings(updated);
              toast.success(next ? "창 항상 위 고정 ON" : "창 항상 위 고정 OFF");
            }}
            title="항상 위에 고정 (Always on Top)"
            className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
              desktopSettings.alwaysOnTop
                ? "text-amber-400 bg-white/10"
                : "text-slate-400 hover:text-white hover:bg-white/5",
            )}
          >
            <Pin className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              handleToggleWindowMode(windowMode === "compact" ? "expanded" : "compact")
            }
            title={
              windowMode === "compact"
                ? "대화목록 + 채팅창 나란히 펼치기"
                : "카톡 미니 창(폭 410px)으로 접기"
            }
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            {windowMode === "compact" ? (
              <Maximize2 className="h-4 w-4" />
            ) : (
              <Minimize2 className="h-4 w-4" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            title="자동 실행 · 자동 로그인 · PC 환경설정"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Settings className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => void signOut()}
            title="로그아웃"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-white/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          2. 우측 메인 컨텐츠: 카톡처럼 항상 [대화상대 | 대화목록] 유지!
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 min-w-0 h-full flex flex-col bg-background overflow-hidden">
        {/* 상단 컴팩트 바 (현장 선택 + 대화상대/대화목록 탭 + 새 대화 버튼) */}
        <header className="px-3 pt-2.5 pb-2 border-b bg-card flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            {/* 현장 선택 드롭다운 (이곳에서 현장을 바꾸면 모든 팝업창의 현장도 즉시 연동됨!) */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {projectAccess && projectAccess.projects.length > 0 ? (
                <Select
                  value={projectAccess.selectedProject}
                  onValueChange={projectAccess.setSelectedProject}
                >
                  <SelectTrigger className="h-7 text-xs font-bold border-0 bg-muted/60 hover:bg-muted px-2.5 rounded-lg max-w-[210px] truncate shadow-none">
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
              ) : (
                <span className="text-xs font-bold text-foreground truncate">
                  SafeNex 메신저
                </span>
              )}
            </div>

            {/* 우측 액션 버튼: 새 대화 / 전체 시스템 팝업 */}
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                onClick={() => setIsNewChatOpen(true)}
                className="h-7 px-2.5 text-[11px] gap-1 rounded-lg"
                title="새 채팅방 만들기"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>새 대화</span>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() =>
                  openDesktopPopoutWindow({
                    url: `${window.location.origin}/app/admin`,
                    title: "SafeNex 통합 안전관리 시스템",
                    width: 1400,
                    height: 900,
                    windowName: "safenex_main_system",
                  })
                }
                title="SafeNex 전체 시스템 큰 창으로 열기"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 카톡 스타일 상단 메인 탭: [대화상대] | [대화목록] */}
          <div className="grid grid-cols-2 rounded-lg bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => {
                setMessengerTab("directory");
                if (windowMode === "compact") setSelectedRoomId(null);
              }}
              className={cn(
                "py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                messengerTab === "directory"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Users className="h-3.5 w-3.5" />
              <span>대화상대</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMessengerTab("rooms");
              }}
              className={cn(
                "py-1.5 rounded-md text-xs font-bold flex items-center justify-center gap-1.5 transition-all",
                messengerTab === "rooms"
                  ? "bg-background text-foreground shadow-2xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>대화목록</span>
              {totalUnreadChats > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#ff3b30] text-white text-[10px] font-extrabold">
                  {totalUnreadChats > 99 ? "99+" : totalUnreadChats}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* 본문: 대화상대/대화목록 또는 채팅창 */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {windowMode === "compact" ? (
            selectedRoom && messengerTab === "rooms" ? (
              <MessengerChatPane
                room={selectedRoom}
                onBack={() => {
                  setSelectedRoomId(null);
                  setSearchParams({}, { replace: true });
                  void loadRooms();
                }}
                onRoomUpdated={loadRooms}
              />
            ) : (
              <div className="flex-1 min-h-0 flex flex-col w-full">
                <MessengerRoomList
                  rooms={rooms}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={handleSelectRoom}
                  onDoubleClickRoom={handlePopoutRoom}
                  onOpenNewChat={() => setIsNewChatOpen(true)}
                  onRoomCreated={(id) => {
                    setSelectedRoomId(id);
                    setMessengerTab("rooms");
                    setSearchParams({ room: id }, { replace: true });
                    void loadRooms();
                  }}
                  currentProjectId={projectAccess?.selectedProject}
                  loading={loadingRooms}
                  forcedTab={messengerTab}
                  onTabChange={(t) => setMessengerTab(t)}
                  hideHeader
                  hideTopTabs
                />
              </div>
            )
          ) : (
            /* 좌우 분할 모드: 좌측에 대화상대/대화목록 + 우측에 열린 채팅방 */
            <>
              <div className="w-80 border-r flex flex-col shrink-0 h-full min-h-0">
                <MessengerRoomList
                  rooms={rooms}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={handleSelectRoom}
                  onDoubleClickRoom={handlePopoutRoom}
                  onOpenNewChat={() => setIsNewChatOpen(true)}
                  onRoomCreated={(id) => {
                    setSelectedRoomId(id);
                    setMessengerTab("rooms");
                    setSearchParams({ room: id }, { replace: true });
                    void loadRooms();
                  }}
                  currentProjectId={projectAccess?.selectedProject}
                  loading={loadingRooms}
                  forcedTab={messengerTab}
                  onTabChange={(t) => setMessengerTab(t)}
                  hideHeader
                  hideTopTabs
                />
              </div>
              <div className="flex-1 min-w-0 h-full min-h-0 flex flex-col">
                {selectedRoom ? (
                  <MessengerChatPane
                    room={selectedRoom}
                    onRoomUpdated={loadRooms}
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground bg-muted/10">
                    <MessageSquare className="h-10 w-10 stroke-1 mb-2 opacity-40" />
                    <p className="text-xs font-semibold text-foreground">
                      대화상대 또는 대화방을 선택하세요
                    </p>
                    <p className="text-[11px] mt-1">
                      좌측 아이콘(알림·공지·결재·대시보드·허가서)을 누르면 맞춤 크기의 팝업창이 열립니다.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 새 대화 개설 모달 */}
      <NewChatDialog
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onRoomCreated={(id) => {
          setSelectedRoomId(id);
          setMessengerTab("rooms");
          setSearchParams({ room: id }, { replace: true });
          void loadRooms();
        }}
        currentProjectId={projectAccess?.selectedProject}
      />

      {/* PC 환경설정 모달 */}
      <DesktopAppSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSettingsChanged={(next) => setDesktopSettings(next)}
      />
    </div>
  );
}
