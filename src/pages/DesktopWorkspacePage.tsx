import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { DesktopAppSettingsDialog } from "@/components/desktop/DesktopAppSettingsDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";
import {
  applyDesktopWindowMode,
  isWindowsDesktopApp,
  loadDesktopPresence,
  loadDesktopSettings,
  openDesktopPopoutWindow,
  saveDesktopPresence,
  saveDesktopSettings,
  updateDesktopTaskbarBadge,
  type DesktopPresenceStatus,
  type DesktopWindowMode,
} from "@/lib/desktopBridge";
import * as P from "@/routes/lazyPages";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Users,
  CheckSquare,
  Bell,
  Receipt,
  FileCheck2,
  ShieldAlert,
  ClipboardList,
  HardHat,
  MapPin,
  LayoutDashboard,
  Settings,
  Plus,
  Columns2,
  Smartphone,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Monitor,
  Power,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RightWorkspaceTarget =
  | "chat"
  | "approvals"
  | "alerts"
  | "safety-cost"
  | "work-permits"
  | "risk-assessment"
  | "work-plans"
  | "tbm-logs"
  | "site-control-map"
  | "dashboard";

interface RailModuleItem {
  id: RightWorkspaceTarget;
  label: string;
  shortLabel: string;
  path: string;
  icon: typeof Receipt;
}

const RAIL_MODULES: RailModuleItem[] = [
  {
    id: "approvals",
    label: "전자결재함",
    shortLabel: "전자결재",
    path: "/app/admin/approvals",
    icon: CheckSquare,
  },
  {
    id: "safety-cost",
    label: "산업안전보건관리비",
    shortLabel: "안전관리비",
    path: "/app/admin/safety-cost",
    icon: Receipt,
  },
  {
    id: "work-permits",
    label: "작업허가서 (PTW)",
    shortLabel: "작업허가서",
    path: "/app/admin/work-permits",
    icon: FileCheck2,
  },
  {
    id: "risk-assessment",
    label: "위험성평가",
    shortLabel: "위험성평가",
    path: "/app/admin/risk-assessment",
    icon: ShieldAlert,
  },
  {
    id: "work-plans",
    label: "작업계획서",
    shortLabel: "작업계획서",
    path: "/app/admin/work-plans",
    icon: ClipboardList,
  },
  {
    id: "tbm-logs",
    label: "TBM 및 일일점검",
    shortLabel: "TBM일지",
    path: "/app/admin/tbm-logs",
    icon: HardHat,
  },
  {
    id: "site-control-map",
    label: "통합 현장 관제맵",
    shortLabel: "관제맵",
    path: "/app/admin/site-control-map",
    icon: MapPin,
  },
  {
    id: "dashboard",
    label: "통합 대시보드",
    shortLabel: "대시보드",
    path: "/app/admin",
    icon: LayoutDashboard,
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
  const { user, profile, roles, rolesReady } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room");
  const initialModule = (searchParams.get("module") as RightWorkspaceTarget | null) || null;
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const [leftTab, setLeftTab] = useState<"rooms" | "directory">("rooms");
  const [rightTarget, setRightTarget] = useState<RightWorkspaceTarget>(
    initialModule || "chat",
  );
  const [isLeftListCollapsed, setIsLeftListCollapsed] = useState(false);
  const [windowMode, setWindowMode] = useState<DesktopWindowMode>(
    () => loadDesktopSettings().defaultWindowMode,
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

  const isNativeDesktop = isWindowsDesktopApp();

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

  // 실시간 메신저 및 결재/알림 구독 + 작업표시줄 배지 동기화
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
    setRightTarget("chat");
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
      width: 440,
      height: 720,
    });
  };

  const handleToggleWindowMode = (nextMode: DesktopWindowMode) => {
    setWindowMode(nextMode);
    applyDesktopWindowMode(nextMode);
    setDesktopSettings(loadDesktopSettings());
    toast.info(
      nextMode === "compact"
        ? "카톡형 미니모드(420px)로 전환되었습니다."
        : "통합 분할 워크스페이스 모드로 전환되었습니다.",
    );
  };

  const handleSelectModule = (target: RightWorkspaceTarget, path: string) => {
    if (windowMode === "compact") {
      // 미니모드에서는 주요 업무 클릭 시 새 창으로 띄우거나 통합 모드로 자동 확장
      handleToggleWindowMode("expanded");
    }
    setRightTarget(target);
    const nextParams: Record<string, string> = { module: target };
    if (selectedRoomId) nextParams.room = selectedRoomId;
    setSearchParams(nextParams, { replace: true });
  };

  const handleCyclePresence = () => {
    const idx = PRESENCE_OPTIONS.findIndex((o) => o.value === presence);
    const next = PRESENCE_OPTIONS[(idx + 1) % PRESENCE_OPTIONS.length];
    setPresence(next.value);
    saveDesktopPresence(next.value);
    toast.success(`근무 상태가 [${next.label}](으)로 변경되었습니다.`);
  };

  const currentPresenceMeta =
    PRESENCE_OPTIONS.find((o) => o.value === presence) || PRESENCE_OPTIONS[0];

  const activeModuleMeta = useMemo(
    () => RAIL_MODULES.find((m) => m.id === rightTarget) || null,
    [rightTarget],
  );

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  return (
    <div className="flex-1 h-full min-h-0 w-full flex flex-col bg-muted/20 overflow-hidden select-none">
      {/* 상단 데스크톱 전용 상태바 (Title / Mode / Auto-Start / Window Controls) */}
      <div className="h-10 px-3 border-b bg-slate-900 text-slate-100 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center gap-1.5 font-bold text-xs tracking-tight text-white">
            <span className="h-5 w-5 rounded-md bg-amber-400 text-slate-950 flex items-center justify-center font-black text-[11px]">
              S
            </span>
            <span>SafeNex PC</span>
          </div>

          {/* 근무 상태 표시기 (클릭 시 전환) */}
          <button
            type="button"
            onClick={handleCyclePresence}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-[11px] font-medium transition-colors"
            title="클릭하여 내 근무 상태 변경 (온라인 / 현장 점검중 / 회의 / 자리비움)"
          >
            <span className={cn("h-2 w-2 rounded-full", currentPresenceMeta.dotClass)} />
            <span>{profile?.display_name || "관리자"}</span>
            <span className="text-slate-400">· {currentPresenceMeta.label}</span>
          </button>

          {/* 자동 실행 및 자동 로그인 상태 배지 */}
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-800 text-[10px] text-slate-300 transition-colors"
            title="윈도우 시작 시 자동 실행 및 자동 로그인 설정"
          >
            <Power
              className={cn(
                "h-3 w-3",
                desktopSettings.autoStartOnBoot ? "text-emerald-400" : "text-slate-500",
              )}
            />
            <span>
              자동실행 {desktopSettings.autoStartOnBoot ? "ON" : "OFF"} · 자동로그인{" "}
              {desktopSettings.keepLoggedIn ? "ON" : "OFF"}
            </span>
          </button>
        </div>

        {/* 우측 창 모드 전환 및 설정 컨트롤 */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-md bg-slate-800 p-0.5 border border-slate-700">
            <button
              type="button"
              onClick={() => handleToggleWindowMode("compact")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors",
                windowMode === "compact"
                  ? "bg-amber-400 text-slate-950 font-bold"
                  : "text-slate-300 hover:text-white",
              )}
              title="카카오톡 PC처럼 슬림한 미니 창(420px)으로 보기"
            >
              <Smartphone className="h-3 w-3" />
              <span>카톡 미니모드</span>
            </button>
            <button
              type="button"
              onClick={() => handleToggleWindowMode("expanded")}
              className={cn(
                "px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors",
                windowMode === "expanded"
                  ? "bg-amber-400 text-slate-950 font-bold"
                  : "text-slate-300 hover:text-white",
              )}
              title="좌측 메신저·조직도 + 우측 주요 업무 통합 워크스페이스로 보기"
            >
              <Columns2 className="h-3 w-3" />
              <span>통합 워크스페이스</span>
            </button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = !desktopSettings.alwaysOnTop;
              const updated = saveDesktopSettings({ alwaysOnTop: next });
              setDesktopSettings(updated);
              toast.success(next ? "창 항상 위 고정이 켜졌습니다." : "항상 위 고정이 해제되었습니다.");
            }}
            className={cn(
              "h-7 px-2 text-[11px] gap-1 hover:bg-slate-800",
              desktopSettings.alwaysOnTop ? "text-amber-400" : "text-slate-300",
            )}
            title="항상 위에 고정 (Always on Top)"
          >
            <Pin className="h-3 w-3" />
            <span className="hidden lg:inline">항상 위</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsSettingsOpen(true)}
            className="h-7 px-2 text-[11px] gap-1 text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            <Monitor className="h-3.5 w-3.5 text-amber-400" />
            <span>{isNativeDesktop ? "PC 설정" : "PC버전(.exe) / 설정"}</span>
          </Button>
        </div>
      </div>

      {/* 메인 본문 영역 (Compact 모드시 중앙/좌측 440px 카톡 프레임으로 시뮬레이션하거나 네이티브 창에 맞춤) */}
      <div className="flex-1 min-h-0 w-full flex justify-center overflow-hidden">
        <div
          className={cn(
            "h-full min-h-0 flex bg-background overflow-hidden transition-all duration-200",
            windowMode === "compact"
              ? "w-full max-w-[440px] border-x shadow-2xl"
              : "w-full",
          )}
        >
          {/* ① 좌측 64px 글로벌 아이콘 레일 (카카오톡 / 네이버웍스 스타일) */}
          <aside className="w-16 bg-slate-900 text-slate-300 flex flex-col items-center py-2.5 justify-between shrink-0 border-r border-slate-800 z-20">
            <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
              {/* 현장 조직도 탭 */}
              <button
                type="button"
                onClick={() => {
                  setLeftTab("directory");
                  setIsLeftListCollapsed(false);
                  if (windowMode === "compact") setSelectedRoomId(null);
                }}
                className={cn(
                  "w-full py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative",
                  leftTab === "directory" && !isLeftListCollapsed
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )}
                title="현장 조직도 (원청·협력사 연락처 및 단체방)"
              >
                <Users className="h-5 w-5" />
                <span className="text-[10px] font-medium">조직도</span>
              </button>

              {/* 대화방 목록 탭 */}
              <button
                type="button"
                onClick={() => {
                  setLeftTab("rooms");
                  setIsLeftListCollapsed(false);
                  setRightTarget("chat");
                }}
                className={cn(
                  "w-full py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative",
                  leftTab === "rooms" && rightTarget === "chat" && !isLeftListCollapsed
                    ? "bg-amber-400 text-slate-950 font-bold"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )}
                title="실시간 대화방 목록"
              >
                <MessageSquare className="h-5 w-5" />
                <span className="text-[10px] font-medium">대화방</span>
                {totalUnreadChats > 0 && (
                  <span className="absolute top-1 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                    {totalUnreadChats > 99 ? "99+" : totalUnreadChats}
                  </span>
                )}
              </button>

              {/* 알림함 바로가기 */}
              <button
                type="button"
                onClick={() => handleSelectModule("alerts", "/app/admin/alerts")}
                className={cn(
                  "w-full py-2 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative",
                  rightTarget === "alerts"
                    ? "bg-slate-800 text-amber-400 font-semibold"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                )}
                title="통합 알림함"
              >
                <Bell className="h-5 w-5" />
                <span className="text-[10px] font-medium">알림</span>
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                    {unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount}
                  </span>
                )}
              </button>

              <div className="w-8 h-px bg-slate-800 my-1" />

              {/* 주요 시스템 업무 바로가기 아이콘들 */}
              {RAIL_MODULES.map((mod) => {
                const Icon = mod.icon;
                const isActive = rightTarget === mod.id;
                const badgeCount = mod.id === "approvals" ? pendingApprovalsCount : 0;

                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => handleSelectModule(mod.id, mod.path)}
                    onDoubleClick={() =>
                      openDesktopPopoutWindow({
                        url: `${window.location.origin}${mod.path}`,
                        title: `SafeNex - ${mod.label}`,
                        width: 1280,
                        height: 860,
                      })
                    }
                    className={cn(
                      "w-full py-1.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative",
                      isActive
                        ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                        : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200",
                    )}
                    title={`${mod.label} (더블클릭 시 독립 새 창으로 열기)`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-[9px] leading-tight truncate max-w-[54px]">
                      {mod.shortLabel}
                    </span>
                    {badgeCount > 0 && (
                      <span className="absolute top-0.5 right-1 min-w-[15px] h-3.5 px-1 rounded-full bg-amber-500 text-slate-950 text-[9px] font-extrabold flex items-center justify-center">
                        {badgeCount > 99 ? "99+" : badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* 하단 접기/펼치기 및 환경설정 아이콘 */}
            <div className="flex flex-col items-center gap-1.5 w-full px-1.5 pt-2 border-t border-slate-800">
              {windowMode === "expanded" && (
                <button
                  type="button"
                  onClick={() => setIsLeftListCollapsed((v) => !v)}
                  className="w-full py-1.5 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  title={
                    isLeftListCollapsed
                      ? "대화목록·조직도 패널 펼치기"
                      : "대화목록·조직도 패널 접기 (업무 화면 넓게 보기)"
                  }
                >
                  {isLeftListCollapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsSettingsOpen(true)}
                className="w-full py-1.5 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                title="PC 메신저 자동 실행 및 환경설정"
              >
                <Settings className="h-4 w-4" />
                <span className="text-[9px] mt-0.5">설정</span>
              </button>
            </div>
          </aside>

          {/* ② 중앙 상시 대화목록 / 현장 조직도 패널 (KakaoTalk 메인 리스트) */}
          {(!isLeftListCollapsed || windowMode === "compact") && (
            <div
              className={cn(
                "border-r flex flex-col shrink-0 h-full min-h-0 bg-background",
                windowMode === "compact"
                  ? selectedRoomId && rightTarget === "chat"
                    ? "hidden"
                    : "flex-1 w-full"
                  : "w-80 lg:w-[340px]",
              )}
            >
              {/* 카톡 스타일 상단 내 프로필 & 새 대화 헤더 */}
              <div className="p-3 border-b bg-card flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="relative shrink-0">
                    <div className="h-9 w-9 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm">
                      {profile?.display_name?.slice(0, 1) || "관"}
                    </div>
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                        currentPresenceMeta.dotClass,
                      )}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold truncate text-foreground">
                        {profile?.display_name || "관리자"}
                      </span>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                        {profile?.company || "현장관리"}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                      <Building2 className="h-2.5 w-2.5 text-primary shrink-0" />
                      <span>
                        {projectAccess?.projects.find(
                          (p) => p.id === projectAccess.selectedProject,
                        )?.name || "전체 현장"}
                      </span>
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => setIsNewChatOpen(true)}
                  className="h-7 px-2.5 text-xs gap-1 shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>새 대화</span>
                </Button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <MessengerRoomList
                  rooms={rooms}
                  selectedRoomId={selectedRoomId}
                  onSelectRoom={handleSelectRoom}
                  onDoubleClickRoom={handlePopoutRoom}
                  onOpenNewChat={() => setIsNewChatOpen(true)}
                  onRoomCreated={(id) => {
                    setSelectedRoomId(id);
                    setRightTarget("chat");
                    setSearchParams({ room: id }, { replace: true });
                    void loadRooms();
                  }}
                  currentProjectId={projectAccess?.selectedProject}
                  loading={loadingRooms}
                  forcedTab={leftTab}
                  onTabChange={setLeftTab}
                  hideHeader
                />
              </div>
            </div>
          )}

          {/* ③ 우측 멀티 워크스페이스 (채팅방 또는 선택한 주요 안전관리 업무 화면) */}
          <div
            className={cn(
              "flex-1 h-full min-h-0 min-w-0 flex flex-col bg-background overflow-hidden",
              windowMode === "compact" && (!selectedRoomId || rightTarget !== "chat")
                ? "hidden"
                : "flex",
            )}
          >
            {rightTarget === "chat" ? (
              selectedRoom ? (
                <MessengerChatPane
                  room={selectedRoom}
                  onBack={
                    windowMode === "compact"
                      ? () => {
                          setSelectedRoomId(null);
                          setSearchParams({}, { replace: true });
                          void loadRooms();
                        }
                      : undefined
                  }
                  onRoomUpdated={loadRooms}
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-muted/10">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-3 shadow-2xs">
                    <MessageSquare className="h-8 w-8 stroke-1.5" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground">
                    SafeNex 카톡형 데스크톱 워크스페이스
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-md leading-relaxed">
                    좌측 목록에서 대화방을 클릭해 실시간 대화를 나누거나, 가장 왼쪽 아이콘 레일에서{" "}
                    <span className="text-foreground font-semibold">
                      전자결재 · 안전관리비 · 작업허가서 · 위험성평가
                    </span>
                    를 클릭해 대화창을 닫지 않고 바로 업무를 처리하세요.
                  </p>
                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-xl w-full">
                    {RAIL_MODULES.slice(0, 4).map((mod) => {
                      const Icon = mod.icon;
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          onClick={() => handleSelectModule(mod.id, mod.path)}
                          className="p-3 rounded-xl border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center gap-1.5 text-center shadow-2xs"
                        >
                          <Icon className="h-5 w-5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">
                            {mod.shortLabel}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              /* 주요 시스템 업무 모듈 임베디드 뷰 */
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* 모듈 상단 컨트롤 바 */}
                <div className="h-10 px-4 border-b bg-muted/30 flex items-center justify-between gap-2 shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="secondary" className="text-[11px] font-bold">
                      {activeModuleMeta?.label || "업무 화면"}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground hidden sm:inline">
                      좌측 대화방·조직도를 유지한 채 업무를 처리합니다
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {selectedRoom && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setRightTarget("chat")}
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-primary" />
                        <span>진행 중인 대화방으로 복귀</span>
                      </Button>
                    )}
                    {activeModuleMeta && (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={() =>
                            openDesktopPopoutWindow({
                              url: `${window.location.origin}${activeModuleMeta.path}`,
                              title: `SafeNex - ${activeModuleMeta.label}`,
                              width: 1280,
                              height: 860,
                            })
                          }
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>독립 새 창으로 열기</span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => navigate(activeModuleMeta.path)}
                        >
                          전체 화면 이동 →
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* 모듈 실제 컴포넌트 렌더링 영역 */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  <Suspense
                    fallback={
                      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                        업무 모듈을 불러오는 중...
                      </div>
                    }
                  >
                    {rightTarget === "approvals" && <P.LazyApprovals />}
                    {rightTarget === "alerts" && <P.LazyNotificationInbox />}
                    {rightTarget === "safety-cost" && <P.LazySafetyCost />}
                    {rightTarget === "work-permits" && <P.LazyWorkPermits />}
                    {rightTarget === "risk-assessment" && <P.LazyAssessmentRuns />}
                    {rightTarget === "work-plans" && <P.LazyWorkPlans />}
                    {rightTarget === "tbm-logs" && <P.LazyTbmLogs />}
                    {rightTarget === "site-control-map" && <P.LazySiteControlMap />}
                    {rightTarget === "dashboard" && <P.LazyDashboard />}
                  </Suspense>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 새 대화 모달 */}
      <NewChatDialog
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onRoomCreated={(id) => {
          setSelectedRoomId(id);
          setRightTarget("chat");
          setSearchParams({ room: id }, { replace: true });
          void loadRooms();
        }}
        currentProjectId={projectAccess?.selectedProject}
      />

      {/* PC 데스크톱 환경설정 및 .exe 설치 다이얼로그 */}
      <DesktopAppSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSettingsChanged={(next) => setDesktopSettings(next)}
      />
    </div>
  );
}
