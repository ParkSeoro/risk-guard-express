import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchChatUnreadTotal } from "@/lib/messengerApi";
import { DesktopAppSettingsDialog } from "@/components/desktop/DesktopAppSettingsDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import { isAllowedForContractor } from "@/lib/contractorRouteAccess";
import {
  checkAndApplyDesktopOtaUpdate,
  restartDesktopShell,
  DESKTOP_MESSENGER_WINDOW_SIZE,
  DESKTOP_WORK_WINDOW_SIZE,
  isWindowsDesktopApp,
  loadDesktopPresence,
  loadDesktopSettings,
  openSafeNexWebSite,
  resizeDesktopWindow,
  saveDesktopPresence,
  saveDesktopSettings,
  updateDesktopTaskbarBadge,
  type DesktopPresenceStatus,
} from "@/lib/desktopBridge";
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
  Pin,
  LogOut,
  ClipboardCheck,
  RefreshCw,
  Globe,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { playMessengerChime } from "@/lib/messengerSound";
import {
  markNotificationAsRead,
  markRelatedNotificationsAsRead,
} from "@/lib/notificationReadHelper";

export type RailTargetId =
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

export interface RailMenuItem {
  id: RailTargetId;
  label: string;
  path: string;
  icon: typeof Bell;
  group: "comm" | "feature";
  /** 해당 메뉴 선택 시 자동으로 맞춰질 창 가로 크기 */
  windowWidth: number;
  /** 해당 메뉴 선택 시 자동으로 맞춰질 창 세로 크기 */
  windowHeight: number;
  /** RoleGuard(마스터/프로젝트관리자/안전관리자 전용) 대상 여부 */
  adminOnly?: boolean;
}

export const DESKTOP_RAIL_ITEMS: RailMenuItem[] = [
  {
    id: "directory",
    label: "대화상대",
    path: "/app/admin/desktop-workspace?tab=directory",
    icon: Users,
    group: "comm",
    windowWidth: DESKTOP_MESSENGER_WINDOW_SIZE.width,
    windowHeight: DESKTOP_MESSENGER_WINDOW_SIZE.height,
  },
  {
    id: "rooms",
    label: "대화목록",
    path: "/app/admin/desktop-workspace?tab=rooms",
    icon: MessageSquare,
    group: "comm",
    windowWidth: DESKTOP_MESSENGER_WINDOW_SIZE.width,
    windowHeight: DESKTOP_MESSENGER_WINDOW_SIZE.height,
  },
  {
    id: "alerts",
    label: "알림",
    path: "/app/admin/alerts",
    icon: Bell,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "announcements",
    label: "공지사항",
    path: "/app/admin/announcements",
    icon: Megaphone,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "approvals",
    label: "전자결재",
    path: "/app/admin/approvals",
    icon: CheckSquare,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "dashboard",
    label: "대시보드",
    path: "/app/admin",
    icon: LayoutDashboard,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "work-permits",
    label: "작업허가서",
    path: "/app/admin/work-permits",
    icon: FileCheck2,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "work-plans",
    label: "작업계획서",
    path: "/app/admin/work-plans",
    icon: ClipboardList,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "risk-assessment",
    label: "위험성평가",
    path: "/app/admin/risk-assessment",
    icon: ShieldAlert,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "tbm-logs",
    label: "TBM 일지",
    path: "/app/admin/tbm-logs",
    icon: HardHat,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "safety-inspections",
    label: "안전점검",
    path: "/app/admin/safety-inspections",
    icon: ClipboardCheck,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
  },
  {
    id: "safety-cost",
    label: "안전관리비",
    path: "/app/admin/safety-cost",
    icon: Receipt,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
    adminOnly: true,
  },
  {
    id: "site-control-map",
    label: "관제맵",
    path: "/app/admin/site-control-map",
    icon: MapPin,
    group: "feature",
    windowWidth: DESKTOP_WORK_WINDOW_SIZE.width,
    windowHeight: DESKTOP_WORK_WINDOW_SIZE.height,
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

export function DesktopRailSidebar() {
  const { user, profile, roles, hasRole, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const projectAccess = useGlobalProjectAccessOptional();

  const [isRailHovered, setIsRailHovered] = useState(false);
  const [presence, setPresence] = useState<DesktopPresenceStatus>(() =>
    loadDesktopPresence(),
  );
  const [desktopSettings, setDesktopSettings] = useState(() =>
    loadDesktopSettings(),
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [totalUnreadChats, setTotalUnreadChats] = useState(0);
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [stagedUpdateVersion, setStagedUpdateVersion] = useState<string | null>(null);

  // 메신저 모드(대화상대/대화목록)에서는 54px 아이콘 레일 + 마우스 오버 시 열림(오버레이),
  // 업무 모드(알림 이하 모든 메뉴)에서는 처음부터 168px 아이콘+글자 고정 표시!
  const isMessengerMode =
    location.pathname.includes("/desktop-workspace") ||
    location.pathname.includes("/messenger");
  const isExpanded = !isMessengerMode || isRailHovered;

  // docs/access-policy.md 원칙:
  // "전역 역할은 마스터뿐이다 (user_roles.role). 그 외 역할은 현장마다 project_members.role_new다. A현장 권한이 B현장으로 넘어가지 않는다."
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
  const currentSiteRole =
    projectAccess && !projectAccess.loading ? projectAccess.userRole : null;
  const isLowPriv =
    !isMaster &&
    (currentSiteRole
      ? LOW_ROLES.has(String(currentSiteRole))
      : roles.length === 0 || roles.every((r) => LOW_ROLES.has(String(r))));
  const restrictToContractorUI = isContractorCo || isLowPriv;

  const visibleItems = useMemo(() => {
    return DESKTOP_RAIL_ITEMS.filter((item) => {
      if (item.group === "comm") return true;
      if (restrictToContractorUI) {
        if (item.adminOnly) return false;
        return isAllowedForContractor(item.path);
      }
      if (item.adminOnly) {
        if (isMaster) return true;
        if (currentSiteRole) {
          return (
            currentSiteRole === "project_admin" ||
            currentSiteRole === "safety_manager"
          );
        }
        return (
          hasRole("project_admin" as any) ||
          hasRole("safety_manager" as any)
        );
      }
      return true;
    });
  }, [restrictToContractorUI, isMaster, currentSiteRole, hasRole]);

  const loadBadges = useCallback(async () => {
    if (!user) return;
    try {
      const [chatUnread, approvalRes, { count: notifCount }] =
        await Promise.all([
          fetchChatUnreadTotal(),
          supabase.rpc("count_my_pending_entity_approvals"),
          supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", user.id)
            .eq("is_read", false),
        ]);
      const approvalCount =
        typeof approvalRes?.data === "number" ? approvalRes.data : 0;
      setTotalUnreadChats(chatUnread || 0);
      setPendingApprovalsCount(approvalCount);
      setUnreadNotificationsCount(notifCount || 0);
    } catch {
      /* ignore */
    }
  }, [user]);

  useEffect(() => {
    void loadBadges();
  }, [loadBadges, location.pathname, location.search]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("desktop-rail-badges")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_room_messages" },
        (payload: any) => {
          void loadBadges();
          if (payload.eventType === "INSERT") {
            const newMsg = payload.new;
            if (newMsg && newMsg.sender_id !== user.id) {
              if (desktopSettings.soundNotification !== false) {
                playMessengerChime();
              }
              if (desktopSettings.desktopNotificationBanner !== false) {
                const preview =
                  newMsg.content && typeof newMsg.content === "string"
                    ? newMsg.content.slice(0, 50)
                    : "새 메시지가 도착했습니다.";
                toast("새 메시지", {
                  description: preview,
                  action: {
                    label: "대화방 보기",
                    onClick: () => {
                      navigate(
                        `/app/admin/desktop-workspace?tab=rooms&room=${newMsg.room_id}`,
                      );
                    },
                  },
                });
              }
              updateDesktopTaskbarBadge(totalUnreadChats + 1, { flash: true });
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          void loadBadges();
          if (payload.eventType === "INSERT") {
            const newNotif = payload.new;
            if (newNotif) {
              if (desktopSettings.soundNotification !== false) {
                playMessengerChime();
              }
              if (desktopSettings.desktopNotificationBanner !== false) {
                const targetRoute = resolveNotificationRoute(newNotif, { mobileShell: false });
                toast(newNotif.title || "새 알림", {
                  description: newNotif.message || newNotif.body || "",
                  action: targetRoute
                    ? {
                        label: "확인",
                        onClick: () => {
                          if (newNotif.id) {
                            void markNotificationAsRead(newNotif.id);
                          }
                          if (user?.id && newNotif.related_id) {
                            void markRelatedNotificationsAsRead(user.id, newNotif.related_id);
                          }
                          void loadBadges();
                          if (targetRoute.startsWith("http")) {
                            if (window.safenexDesktop?.openExternal) {
                              void window.safenexDesktop.openExternal(targetRoute);
                            } else {
                              window.open(targetRoute, "_blank");
                            }
                          } else {
                            // 업무 페이지로 이동 시 데스크톱 창 자동 확장
                            if (!targetRoute.includes("/desktop-workspace") && !targetRoute.includes("/messenger")) {
                              resizeDesktopWindow(DESKTOP_WORK_WINDOW_SIZE.width, DESKTOP_WORK_WINDOW_SIZE.height);
                            }
                            navigate(targetRoute);
                          }
                        },
                      }
                    : undefined,
                });
              }
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadBadges, desktopSettings, totalUnreadChats, navigate]);

  useEffect(() => {
    updateDesktopTaskbarBadge(totalUnreadChats + pendingApprovalsCount);
  }, [totalUnreadChats, pendingApprovalsCount]);

  // 무설치 원격 자동 업데이트(OTA):
  // 실행 시 및 10분 주기로 Supabase app_releases의 최신 빌드를 확인해 백그라운드에서 자동 다운로드·교체
  useEffect(() => {
    if (
      !isWindowsDesktopApp() &&
      window.location.hostname !== "127.0.0.1" &&
      window.location.hostname !== "localhost"
    ) {
      return;
    }
    let cancelled = false;
    const runAutoUpdateCheck = async () => {
      const res = await checkAndApplyDesktopOtaUpdate();
      if (cancelled) return;
      if (res.pendingRestart && res.latestVersion) {
        setStagedUpdateVersion(res.latestVersion);
        toast.success(res.message);
      } else if (!res.ok && res.hasUpdate) {
        toast.error(res.message);
      }
    };
    const initTimer = window.setTimeout(() => void runAutoUpdateCheck(), 4000);
    const interval = window.setInterval(() => void runAutoUpdateCheck(), 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearTimeout(initTimer);
      window.clearInterval(interval);
    };
  }, []);

  const isItemActive = (item: RailMenuItem): boolean => {
    const pathname = location.pathname;
    const searchParams = new URLSearchParams(location.search);
    if (item.id === "directory") {
      return (
        pathname.includes("/desktop-workspace") &&
        searchParams.get("tab") !== "rooms" &&
        !searchParams.get("room")
      );
    }
    if (item.id === "rooms") {
      return (
        (pathname.includes("/desktop-workspace") &&
          (searchParams.get("tab") === "rooms" || !!searchParams.get("room"))) ||
        pathname.includes("/messenger")
      );
    }
    if (item.path === "/app/admin") {
      return pathname === "/app/admin" || pathname === "/app/admin/";
    }
    if (item.id === "work-plans") {
      return (
        pathname.startsWith("/app/admin/work-plans") ||
        pathname.startsWith("/app/admin/work-plan/")
      );
    }
    if (item.id === "risk-assessment") {
      return (
        pathname.startsWith("/app/admin/risk-assessment") ||
        pathname.startsWith("/app/admin/assessment-run/")
      );
    }
    return pathname === item.path || pathname.startsWith(`${item.path}/`);
  };

  const handleSelectItem = (item: RailMenuItem) => {
    setIsRailHovered(false);
    resizeDesktopWindow(item.windowWidth, item.windowHeight);
    navigate(item.path);
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

  const commItems = visibleItems.filter((i) => i.group === "comm");
  const featureItems = visibleItems.filter((i) => i.group === "feature");

  return (
    <>
      <div
        className={cn(
          "relative h-full shrink-0 select-none z-40",
          isMessengerMode ? "w-[54px]" : "w-[168px]",
        )}
      >
        <aside
          onMouseEnter={() => {
            if (isMessengerMode) setIsRailHovered(true);
          }}
          onMouseLeave={() => {
            if (isMessengerMode) setIsRailHovered(false);
          }}
          className={cn(
            "bg-[#1e2229] text-slate-300 h-full flex flex-col justify-between py-2.5 transition-[width] duration-150 ease-out border-r border-white/10 overflow-hidden",
            isMessengerMode
              ? isExpanded
                ? "absolute inset-y-0 left-0 w-[168px] px-2 shadow-2xl z-50"
                : "w-[54px] px-1.5 items-center"
              : "w-[168px] px-2",
          )}
        >
          <div className="flex flex-col gap-0.5 w-full overflow-y-auto no-scrollbar">
            {/* 상단 내 상태 아바타 */}
            <button
              type="button"
              onClick={handleCyclePresence}
              title={`${profile?.display_name || "관리자"} (${currentPresenceMeta.label})`}
              className={cn(
                "flex items-center gap-2.5 rounded-xl p-1.5 mb-1 hover:bg-white/10 transition-colors text-left",
                !isExpanded && "justify-center",
              )}
            >
              <div className="relative shrink-0">
                <div className="h-8 w-8 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-xs flex items-center justify-center shadow-xs">
                  {profile?.display_name?.slice(0, 1) || "S"}
                </div>
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#1e2229]",
                    currentPresenceMeta.dotClass,
                  )}
                />
              </div>
              {isExpanded && (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <p className="text-xs font-bold text-white truncate">
                    {profile?.display_name || "관리자"}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {currentPresenceMeta.label}
                  </p>
                </div>
              )}
            </button>

            {/* 1. 대화상대 / 대화목록 */}
            {commItems.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item);
              const badge = item.id === "rooms" ? totalUnreadChats : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectItem(item)}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    "relative h-8 rounded-lg flex items-center gap-2.5 transition-all",
                    isExpanded ? "w-full px-2.5 justify-start" : "w-9 justify-center mx-auto",
                    active
                      ? "bg-amber-400 text-slate-950 font-bold shadow-xs"
                      : "text-slate-300 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {isExpanded && (
                    <span className="text-xs whitespace-nowrap truncate flex-1 text-left">
                      {item.label}
                    </span>
                  )}
                  {badge > 0 && (
                    <span
                      className={cn(
                        "min-w-[16px] h-4 px-1 rounded-full bg-[#ff3b30] text-white text-[9px] font-extrabold flex items-center justify-center",
                        !isExpanded && "absolute -top-0.5 -right-0.5",
                      )}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="w-full h-px bg-white/10 my-1" />

            {/* 2. 주요 시스템 메뉴 (알림 이하 모든 업무 화면은 1260×820 동일 크기 + 아이콘 옆 글자 고정 표시) */}
            {featureItems.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(item);
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
                  onClick={() => handleSelectItem(item)}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    "relative h-8 rounded-lg flex items-center gap-2.5 transition-all",
                    isExpanded ? "w-full px-2.5 justify-start" : "w-9 justify-center mx-auto",
                    active
                      ? "bg-amber-400 text-slate-950 font-bold shadow-xs"
                      : "text-slate-300 hover:bg-white/10 hover:text-white",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {isExpanded && (
                    <span className="text-xs whitespace-nowrap truncate flex-1 text-left">
                      {item.label}
                    </span>
                  )}
                  {badge > 0 && (
                    <span
                      className={cn(
                        "min-w-[15px] h-3.5 px-1 rounded-full text-[9px] font-black flex items-center justify-center",
                        !isExpanded && "absolute -top-0.5 -right-0.5",
                        item.id === "alerts"
                          ? "bg-[#ff3b30] text-white"
                          : active
                            ? "bg-slate-950 text-amber-400"
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

          {/* 하단 고정 액션: 무설치 업데이트 알림 / 웹 사이트 바로가기 / 항상 위 고정 / 환경설정 / 로그아웃 */}
          <div className="flex flex-col gap-0.5 w-full pt-2 border-t border-white/10">
            {stagedUpdateVersion && (
              <button
                type="button"
                onClick={() => {
                  void restartDesktopShell().then((started) => {
                    if (!started) {
                      toast.info("프로그램을 완전히 종료한 뒤 다시 열면 새 버전이 적용됩니다.");
                    }
                  });
                }}
                title={`새 버전(v${stagedUpdateVersion})은 프로그램을 다시 열면 적용됩니다`}
                className={cn(
                  "h-8 rounded-lg flex items-center gap-2 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 font-semibold transition-colors mb-0.5",
                  isExpanded ? "w-full px-2.5 justify-start" : "w-8 justify-center mx-auto",
                )}
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                {isExpanded && (
                  <span className="text-[11px] whitespace-nowrap truncate">
                    다시 시작하여 적용 (v{stagedUpdateVersion})
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (window.safenexDesktop?.openExternal) {
                  void window.safenexDesktop.openExternal("https://safenex.org/app/admin");
                } else {
                  openSafeNexWebSite(location.pathname, location.search);
                }
                toast.info("기본 웹 브라우저에서 SafeNex 사이트를 엽니다.");
              }}
              title="SafeNex 웹 사이트 바로가기 (기본 브라우저 전체 화면으로 열기)"
              aria-label="웹 사이트 바로가기"
              className={cn(
                "h-8 rounded-lg flex items-center gap-2.5 text-sky-300 hover:text-white hover:bg-sky-500/20 transition-colors",
                isExpanded ? "w-full px-2.5 justify-start" : "w-8 justify-center mx-auto",
              )}
            >
              <Globe className="h-4 w-4 shrink-0" />
              {isExpanded && (
                <>
                  <span className="text-xs whitespace-nowrap flex-1 text-left font-medium">
                    웹 사이트 바로가기
                  </span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !desktopSettings.alwaysOnTop;
                const updated = saveDesktopSettings({ alwaysOnTop: next });
                setDesktopSettings(updated);
                toast.success(next ? "창 항상 위 고정 켜짐" : "창 항상 위 고정 꺼짐");
              }}
              title="항상 위에 고정"
              className={cn(
                "h-8 rounded-lg flex items-center gap-2.5 transition-colors",
                isExpanded ? "w-full px-2.5 justify-start" : "w-8 justify-center mx-auto",
                desktopSettings.alwaysOnTop
                  ? "text-amber-400 bg-white/10 font-semibold"
                  : "text-slate-400 hover:text-white hover:bg-white/10",
              )}
            >
              <Pin className="h-4 w-4 shrink-0" />
              {isExpanded && (
                <span className="text-xs whitespace-nowrap">항상 위 고정</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              title="환경설정 및 업데이트"
              className={cn(
                "h-8 rounded-lg flex items-center gap-2.5 text-slate-400 hover:text-white hover:bg-white/10 transition-colors",
                isExpanded ? "w-full px-2.5 justify-start" : "w-8 justify-center mx-auto",
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {isExpanded && (
                <span className="text-xs whitespace-nowrap">환경설정</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => void signOut()}
              title="로그아웃"
              className={cn(
                "h-8 rounded-lg flex items-center gap-2.5 text-slate-400 hover:text-red-400 hover:bg-white/10 transition-colors",
                isExpanded ? "w-full px-2.5 justify-start" : "w-8 justify-center mx-auto",
              )}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              {isExpanded && (
                <span className="text-xs whitespace-nowrap">로그아웃</span>
              )}
            </button>
          </div>
        </aside>
      </div>

      <DesktopAppSettingsDialog
        open={isSettingsOpen}
        onOpenChange={(open) => {
          setIsSettingsOpen(open);
          if (!open) setDesktopSettings(loadDesktopSettings());
        }}
      />
    </>
  );
}
