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
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ActiveMenuTarget =
  | "directory"
  | "rooms"
  | "alerts"
  | "announcements"
  | "approvals"
  | "dashboard"
  | "work-permits"
  | "safety-cost"
  | "risk-assessment"
  | "work-plans"
  | "tbm-logs"
  | "site-control-map";

interface RailIconItem {
  id: ActiveMenuTarget;
  label: string;
  path: string;
  icon: typeof Bell;
  group: "comm" | "work";
}

const RAIL_ICONS: RailIconItem[] = [
  {
    id: "directory",
    label: "대화상대 (현장 조직도)",
    path: "/app/admin/desktop-workspace",
    icon: Users,
    group: "comm",
  },
  {
    id: "rooms",
    label: "대화목록 (채팅)",
    path: "/app/admin/desktop-workspace",
    icon: MessageSquare,
    group: "comm",
  },
  {
    id: "alerts",
    label: "알림함",
    path: "/app/admin/alerts",
    icon: Bell,
    group: "comm",
  },
  {
    id: "announcements",
    label: "공지사항",
    path: "/app/admin/announcements",
    icon: Megaphone,
    group: "comm",
  },
  {
    id: "approvals",
    label: "전자결재",
    path: "/app/admin/approvals",
    icon: CheckSquare,
    group: "work",
  },
  {
    id: "dashboard",
    label: "대시보드",
    path: "/app/admin",
    icon: LayoutDashboard,
    group: "work",
  },
  {
    id: "work-permits",
    label: "작업허가서 (PTW)",
    path: "/app/admin/work-permits",
    icon: FileCheck2,
    group: "work",
  },
  {
    id: "safety-cost",
    label: "산업안전보건관리비",
    path: "/app/admin/safety-cost",
    icon: Receipt,
    group: "work",
  },
  {
    id: "risk-assessment",
    label: "위험성평가",
    path: "/app/admin/risk-assessment",
    icon: ShieldAlert,
    group: "work",
  },
  {
    id: "work-plans",
    label: "작업계획서",
    path: "/app/admin/work-plans",
    icon: ClipboardList,
    group: "work",
  },
  {
    id: "tbm-logs",
    label: "TBM 및 일일점검",
    path: "/app/admin/tbm-logs",
    icon: HardHat,
    group: "work",
  },
  {
    id: "site-control-map",
    label: "통합 현장 관제맵",
    path: "/app/admin/site-control-map",
    icon: MapPin,
    group: "work",
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
  const { user, profile, roles, rolesReady, signOut } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room");
  const initialModule = (searchParams.get("module") as ActiveMenuTarget | null) || null;
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  // 카톡처럼 상단 기본 탭은 '대화상대(directory)' 또는 '대화목록(rooms)'
  const [messengerTab, setMessengerTab] = useState<"directory" | "rooms">(
    initialRoomId ? "rooms" : "directory",
  );
  const [activeMenu, setActiveMenu] = useState<ActiveMenuTarget>(
    initialModule || (initialRoomId ? "rooms" : "directory"),
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
    setActiveMenu("rooms");
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
        window.resizeTo(1360, 880);
      }
    } catch {
      /* ignore if browser blocks resizeTo */
    }
  };

  const handleRailIconClick = (item: RailIconItem) => {
    if (item.id === "directory") {
      setMessengerTab("directory");
      setActiveMenu("directory");
      if (windowMode === "compact") setSelectedRoomId(null);
      setSearchParams({}, { replace: true });
      return;
    }
    if (item.id === "rooms") {
      setMessengerTab("rooms");
      setActiveMenu("rooms");
      setSearchParams(selectedRoomId ? { room: selectedRoomId } : {}, { replace: true });
      return;
    }

    // 카톡 미니모드(작은 창)에서 대시보드·작업허가서·안전관리비 같은 무거운 업무를 누르면:
    // 알림/공지사항/전자결재는 미니 창 안에서도 바로 볼 수 있고, 더블클릭하거나 새창 버튼을 누르면 큰 창으로 뜸!
    setActiveMenu(item.id);
    setSearchParams({ module: item.id }, { replace: true });
  };

  const handleRailIconDoubleClick = (item: RailIconItem) => {
    if (item.id === "directory" || item.id === "rooms") return;
    openDesktopPopoutWindow({
      url: `${window.location.origin}${item.path}`,
      title: `SafeNex - ${item.label}`,
      width: 1280,
      height: 860,
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

  const activeRailItem = useMemo(
    () => RAIL_ICONS.find((i) => i.id === activeMenu) || RAIL_ICONS[0],
    [activeMenu],
  );

  const isMessengerView = activeMenu === "directory" || activeMenu === "rooms";

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  return (
    <div className="h-dvh w-screen flex bg-background overflow-hidden select-none">
      {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
          1. 좌측 순수 아이콘 레일 (폭 54px, 카카오톡 PC 스타일 — 텍스트 없이 깔끔한 아이콘만!)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <aside className="w-[54px] bg-[#1e2229] text-slate-400 flex flex-col items-center py-3 justify-between shrink-0 z-30">
        {/* 상단: 로고 + 메신저/알림/공지/업무 아이콘 */}
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

          {/* 소통 아이콘 그룹 (대화상대 / 대화목록 / 알림 / 공지사항) */}
          {RAIL_ICONS.filter((i) => i.group === "comm").map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;
            const badge =
              item.id === "rooms"
                ? totalUnreadChats
                : item.id === "alerts"
                  ? unreadNotificationsCount
                  : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRailIconClick(item)}
                onDoubleClick={() => handleRailIconDoubleClick(item)}
                title={item.label}
                aria-label={item.label}
                className={cn(
                  "relative h-10 w-10 rounded-xl flex items-center justify-center transition-all",
                  isActive
                    ? "bg-white/15 text-white shadow-xs"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                <Icon className="h-[20px] w-[20px]" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#ff3b30] text-white text-[9px] font-extrabold flex items-center justify-center shadow-xs">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}

          <div className="w-6 h-px bg-white/10 my-1" />

          {/* 주요 안전관리 기능 아이콘 그룹 (전자결재 / 대시보드 / 허가서 / 안전관리비 등) */}
          {RAIL_ICONS.filter((i) => i.group === "work").map((item) => {
            const Icon = item.icon;
            const isActive = activeMenu === item.id;
            const badge = item.id === "approvals" ? pendingApprovalsCount : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleRailIconClick(item)}
                onDoubleClick={() => handleRailIconDoubleClick(item)}
                title={`${item.label} (클릭: 열기 · 더블클릭: 큰 새 창으로 열기)`}
                aria-label={item.label}
                className={cn(
                  "relative h-9 w-9 rounded-xl flex items-center justify-center transition-all",
                  isActive
                    ? "bg-amber-400 text-slate-950 shadow-xs"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200",
                )}
              >
                <Icon className="h-[18px] w-[18px]" />
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-3.5 px-1 rounded-full bg-amber-400 text-slate-950 text-[9px] font-black flex items-center justify-center border border-[#1e2229]">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 하단: 항상 위 고정 / 창 확장·축소 / 설정 / 로그아웃 */}
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
                ? "넓은 분할 창으로 펼치기"
                : "카톡형 미니 창(우측 구석용)으로 줄이기"
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
          2. 우측 메인 컨텐츠 영역 (카톡처럼 상단에 [대화상대 | 대화목록] 및 현장 선택)
         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 min-w-0 h-full flex flex-col bg-background overflow-hidden">
        {/* 상단 컴팩트 바 (현장 선택 + 대화상대/대화목록 탭 + 새 대화 버튼) */}
        <header className="px-3 pt-2.5 pb-2 border-b bg-card flex flex-col gap-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            {/* 내 이름·직책 및 현장 드롭다운 */}
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

            {/* 우측 액션 버튼: 새 대화 / 웹 전체화면 열기 */}
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
                  })
                }
                title="SafeNex 전체 시스템 큰 창으로 열기"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 카톡 스타일 상단 메인 탭: [대화상대] | [대화목록] (또는 선택된 기능 헤더) */}
          {isMessengerView ? (
            <div className="grid grid-cols-2 rounded-lg bg-muted/50 p-0.5">
              <button
                type="button"
                onClick={() => {
                  setMessengerTab("directory");
                  setActiveMenu("directory");
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
                  setActiveMenu("rooms");
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
          ) : (
            <div className="flex items-center justify-between pt-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setActiveMenu(messengerTab);
                    setSearchParams({}, { replace: true });
                  }}
                  title="대화상대/대화목록으로 돌아가기"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs font-bold text-foreground truncate">
                  {activeRailItem.label}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={() =>
                  openDesktopPopoutWindow({
                    url: `${window.location.origin}${activeRailItem.path}`,
                    title: `SafeNex - ${activeRailItem.label}`,
                    width: 1280,
                    height: 860,
                  })
                }
              >
                <ExternalLink className="h-3 w-3" />
                <span>새 창으로 크게 열기</span>
              </Button>
            </div>
          )}
        </header>

        {/* 본문 영역 */}
        <div className="flex-1 min-h-0 flex overflow-hidden">
          {isMessengerView ? (
            windowMode === "compact" ? (
              /* 카톡 미니 창 모드: 대화방 선택 전에는 대화상대/대화목록 리스트, 선택 시 채팅방 진입 */
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
                      setActiveMenu("rooms");
                      setSearchParams({ room: id }, { replace: true });
                      void loadRooms();
                    }}
                    currentProjectId={projectAccess?.selectedProject}
                    loading={loadingRooms}
                    forcedTab={messengerTab}
                    onTabChange={(t) => {
                      setMessengerTab(t);
                      setActiveMenu(t);
                    }}
                    hideHeader
                    hideTopTabs
                  />
                </div>
              )
            ) : (
              /* 확장 모드: 좌측에 대화상대/대화목록 + 우측에 열린 채팅방 나란히 표시 */
              <>
                <div className="w-80 lg:w-[340px] border-r flex flex-col shrink-0 h-full min-h-0">
                  <MessengerRoomList
                    rooms={rooms}
                    selectedRoomId={selectedRoomId}
                    onSelectRoom={handleSelectRoom}
                    onDoubleClickRoom={handlePopoutRoom}
                    onOpenNewChat={() => setIsNewChatOpen(true)}
                    onRoomCreated={(id) => {
                      setSelectedRoomId(id);
                      setMessengerTab("rooms");
                      setActiveMenu("rooms");
                      setSearchParams({ room: id }, { replace: true });
                      void loadRooms();
                    }}
                    currentProjectId={projectAccess?.selectedProject}
                    loading={loadingRooms}
                    forcedTab={messengerTab}
                    onTabChange={(t) => {
                      setMessengerTab(t);
                      setActiveMenu(t);
                    }}
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
                        대화방을 더블클릭하면 별도의 새 창으로 분리됩니다.
                      </p>
                    </div>
                  )}
                </div>
              </>
            )
          ) : (
            /* 좌측 아이콘에서 알림 / 공지사항 / 전자결재 / 대시보드 / 허가서 등을 눌렀을 때 */
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              <Suspense
                fallback={
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                    불러오는 중...
                  </div>
                }
              >
                {activeMenu === "alerts" && <P.LazyNotificationInbox />}
                {activeMenu === "announcements" && <P.LazyProjectAnnouncements />}
                {activeMenu === "approvals" && <P.LazyApprovals />}
                {activeMenu === "dashboard" && <P.LazyDashboard />}
                {activeMenu === "work-permits" && <P.LazyWorkPermits />}
                {activeMenu === "safety-cost" && <P.LazySafetyCost />}
                {activeMenu === "risk-assessment" && <P.LazyAssessmentRuns />}
                {activeMenu === "work-plans" && <P.LazyWorkPlans />}
                {activeMenu === "tbm-logs" && <P.LazyTbmLogs />}
                {activeMenu === "site-control-map" && <P.LazySiteControlMap />}
              </Suspense>
            </div>
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
          setActiveMenu("rooms");
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
