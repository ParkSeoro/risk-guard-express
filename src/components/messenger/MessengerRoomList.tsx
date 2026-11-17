import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChatRoom,
  fetchChatContacts,
  getFavoriteRoomIds,
  openOrCreateSelfChatRoom,
  toggleFavoriteRoomId,
  type ChatContact,
  type ChatRoom,
} from "@/lib/messengerApi";
import {
  dedupeChatContacts,
  formatCleanRoomPreview,
  groupContactsByCompany,
} from "@/lib/chatMessages";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  MessageSquare,
  Users,
  User,
  ShieldCheck,
  Star,
  BellOff,
  Megaphone,
  Building2,
  Phone,
  MessageCirclePlus,
  ExternalLink,
  Lock,
  Settings2,
  NotebookPen,
} from "lucide-react";
import { messengerType } from "@/lib/messengerType";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { canOpenCouncil } from "@/lib/councilAccess";

export const DEV_COUNCIL_ROOM: ChatRoom = {
  id: "dev-ai-council",
  title: "AI Council 무장애 관제실",
  type: "group",
  created_at: new Date().toISOString(),
  last_message: "Gemini와 Cursor가 이야기합니다",
  last_message_at: new Date().toISOString(),
  unread_count: 0
} as any;

interface MessengerRoomListProps {
  rooms: ChatRoom[];
  selectedRoomId?: string | null;
  onSelectRoom: (room: ChatRoom) => void;
  onDoubleClickRoom?: (room: ChatRoom) => void;
  onOpenNewChat: () => void;
  onRoomCreated?: (roomId: string) => void;
  currentProjectId?: string | null;
  loading?: boolean;
  forcedTab?: "rooms" | "directory";
  onTabChange?: (tab: "rooms" | "directory") => void;
  hideHeader?: boolean;
  hideTopTabs?: boolean;
  onLockNow?: () => void;
  onOpenLockSettings?: () => void;
  isLockConfigured?: boolean;
}

export function MessengerRoomList({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onDoubleClickRoom,
  onOpenNewChat,
  onRoomCreated,
  currentProjectId,
  loading = false,
  forcedTab,
  onTabChange,
  hideHeader = false,
  hideTopTabs = false,
  onLockNow,
  onOpenLockSettings,
  isLockConfigured = false,
}: MessengerRoomListProps) {
  const { user } = useAuth();
  const isCouncilDirector = canOpenCouncil(user);

  const [internalTab, setInternalTab] = useState<"rooms" | "directory">("rooms");
  const activeTab = forcedTab ?? internalTab;
  const setActiveTab = (next: "rooms" | "directory") => {
    setInternalTab(next);
    onTabChange?.(next);
  };
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "favorite" | "direct" | "group">("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteRoomIds());

  // 현장 조직도 탭 상태
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [startingChatId, setStartingChatId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (activeTab !== "directory") return;
    let cancelled = false;
    setLoadingContacts(true);
    fetchChatContacts(currentProjectId, search)
      .then((res) => {
        if (!cancelled) setContacts(dedupeChatContacts(res));
      })
      .finally(() => {
        if (!cancelled) setLoadingContacts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, currentProjectId, search]);

  const formatLastTime = (isoString?: string | null) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday =
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear();

      if (isToday) {
        return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
      }
      return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
    } catch {
      return "";
    }
  };

  const unreadRoomsCount = useMemo(
    () => rooms.filter((r) => (r.unread_count || 0) > 0).length,
    [rooms],
  );

  const filteredRooms = useMemo(() => {
    const favSet = new Set(favoriteIds);
    const list = rooms.filter((room) => {
      if (filter === "unread" && !(room.unread_count && room.unread_count > 0)) return false;
      if (filter === "favorite" && !favSet.has(room.id)) return false;
      if (filter === "direct" && room.is_group) return false;
      if (filter === "group" && !room.is_group) return false;

      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      const titleMatch = (room.custom_name || room.name || "").toLowerCase().includes(q);
      const otherMatch = room.other_participant?.full_name?.toLowerCase().includes(q);
      const companyMatch = room.other_participant?.company_name?.toLowerCase().includes(q);
      const partMatch = (room.participants || []).some(
        (p) =>
          p.full_name?.toLowerCase().includes(q) ||
          p.company_name?.toLowerCase().includes(q),
      );
      const lastMsgMatch = formatCleanRoomPreview(room.last_message_text)
        .toLowerCase()
        .includes(q);

      return titleMatch || otherMatch || companyMatch || partMatch || lastMsgMatch;
    });

    // 나와의 채팅 → 즐겨찾기 고정된 대화방을 최상단에 배치
    return [...list].sort((a, b) => {
      if (Boolean(a.is_self_chat) !== Boolean(b.is_self_chat)) {
        return a.is_self_chat ? -1 : 1;
      }
      const aFav = favSet.has(a.id);
      const bFav = favSet.has(b.id);
      if (aFav !== bFav) return aFav ? -1 : 1;
      const aTime = a.last_message_at || a.created_at || "";
      const bTime = b.last_message_at || b.created_at || "";
      return bTime.localeCompare(aTime);
    });
  }, [rooms, filter, search, favoriteIds]);

  const hasSelfChatRoom = useMemo(() => rooms.some((r) => r.is_self_chat), [rooms]);

  const handleOpenSelfChat = async (popout = false) => {
    if (startingChatId) return;
    setStartingChatId("self-chat");
    try {
      const existing = rooms.find((r) => r.is_self_chat);
      const roomId = existing?.id || (await openOrCreateSelfChatRoom());
      if (!roomId) {
        toast.error("나와의 채팅방을 열지 못했습니다.");
        return;
      }
      setActiveTab("rooms");
      if (popout && onDoubleClickRoom) {
        onDoubleClickRoom(
          existing || ({ id: roomId, name: "나와의 채팅", is_group: false, is_self_chat: true } as ChatRoom),
        );
      } else {
        onRoomCreated?.(roomId);
      }
    } finally {
      setStartingChatId(null);
    }
  };

  const companyGroups = useMemo(() => groupContactsByCompany(contacts), [contacts]);

  const handleToggleFavorite = (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    setFavoriteIds(toggleFavoriteRoomId(roomId));
  };

  const handleStartDirectChat = async (contact: ChatContact, opts?: { popout?: boolean }) => {
    if (startingChatId) return;
    setStartingChatId(contact.user_id);
    try {
      const roomId = await createChatRoom({
        name: null,
        isGroup: false,
        projectId: currentProjectId || contact.project_id || null,
        inviteUserIds: [contact.user_id],
      });
      if (roomId) {
        setActiveTab("rooms");
        if (opts?.popout && onDoubleClickRoom) {
          onDoubleClickRoom({
            id: roomId,
            name: contact.full_name || "1:1 대화",
            is_group: false,
          } as ChatRoom);
        } else {
          onRoomCreated?.(roomId);
        }
      } else {
        toast.error("대화방을 열지 못했습니다.");
      }
    } finally {
      setStartingChatId(null);
    }
  };

  const handleStartCompanyGroupChat = async (companyName: string, members: ChatContact[]) => {
    if (startingChatId || members.length === 0) return;
    setStartingChatId(`company:${companyName}`);
    try {
      const roomId = await createChatRoom({
        name: `${companyName} 안전협의방`,
        isGroup: true,
        projectId: currentProjectId || members[0]?.project_id || null,
        inviteUserIds: members.map((m) => m.user_id),
      });
      if (roomId) {
        toast.success(`${companyName} 안전협의방이 개설되었습니다.`);
        setActiveTab("rooms");
        onRoomCreated?.(roomId);
      } else {
        toast.error("그룹 대화방 개설에 실패했습니다.");
      }
    } finally {
      setStartingChatId(null);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-background overflow-hidden">
      {/* 헤더 및 새 대화 / 잠금 버튼 */}
      {!hideHeader && (
        <div className="p-3 pt-[max(0.75rem,var(--sat))] border-b bg-card shrink-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <MessageSquare className="h-4 w-4" />
            </div>
            <h2 className={cn(messengerType.title, "truncate")}>SafeNex 메신저</h2>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isLockConfigured && onLockNow && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onLockNow}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="지금 메신저 잠금"
              >
                <Lock className="h-3.5 w-3.5" />
              </Button>
            )}
            {onOpenLockSettings && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onOpenLockSettings}
                className={cn(
                  "h-8 w-8",
                  isLockConfigured ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                title={isLockConfigured ? "잠금 설정 (켜짐)" : "메신저 자동 잠금 설정"}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              onClick={onOpenNewChat}
              className={cn("h-8 px-2.5 gap-1 rounded-lg shadow-2xs", messengerType.preview)}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>새 대화</span>
            </Button>
          </div>
        </div>
      )}

      {/* 상단 2탭 전환: 대화방 | 현장 조직도 */}
      {!hideTopTabs && (
        <div className="grid grid-cols-2 border-b bg-muted/30 shrink-0 p-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("rooms")}
            className={cn(
              "py-2 rounded-md flex items-center justify-center gap-1.5 transition-colors",
              messengerType.preview,
              activeTab === "rooms"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>대화방</span>
            {unreadRoomsCount > 0 && (
              <span className={cn("px-1.5 py-0.2 rounded-full bg-red-500 text-white font-bold", messengerType.meta)}>
                {unreadRoomsCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("directory")}
            className={cn(
              "py-2 rounded-md flex items-center justify-center gap-1.5 transition-colors",
              messengerType.preview,
              activeTab === "directory"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>현장 조직도</span>
          </button>
        </div>
      )}

      {/* 검색 및 필터 바 */}
      <div className="p-2.5 border-b bg-muted/20 space-y-2 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            placeholder={
              activeTab === "rooms"
                ? "대화방, 참가자, 업체명 검색..."
                : "조직도에서 이름 또는 소속 업체 검색..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={cn("pl-8 pr-14 h-10 bg-background", messengerType.preview)}
          />
          <kbd
            onClick={() => searchInputRef.current?.focus()}
            className="absolute right-2.5 hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted/80 border rounded shadow-2xs cursor-pointer select-none"
            title="검색 단축키: Ctrl + K"
          >
            Ctrl+K
          </kbd>
        </div>

        {activeTab === "rooms" && (
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {(
              [
                { key: "all", label: "전체" },
                {
                  key: "unread",
                  label: unreadRoomsCount > 0 ? `안읽음 ${unreadRoomsCount}` : "안읽음",
                },
                { key: "favorite", label: "즐겨찾기" },
                { key: "direct", label: "1:1" },
                { key: "group", label: "그룹" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "px-2.5 py-1 rounded-full font-medium transition-colors shrink-0",
                  messengerType.meta,
                  filter === item.key
                    ? "bg-primary text-primary-foreground shadow-2xs"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 본문 영역: 대화방 목록 또는 현장 조직도 */}
      {activeTab === "rooms" ? (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/60">
          {/* 박서로 디렉터 마스터 전용 AI Council 무장애 의회 관제실 */}
          {isCouncilDirector && (
            <div className="p-2 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-card/60 border-b">
              <button
                type="button"
                onClick={() => onSelectRoom(DEV_COUNCIL_ROOM)}
                className={cn(
                  "w-full p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all shadow-xs",
                  selectedRoomId === "dev-ai-council"
                    ? "bg-indigo-600 text-white border-indigo-400 shadow-md"
                    : "bg-card/90 hover:bg-card border-indigo-500/40 text-foreground"
                )}
              >
                <div className="relative shrink-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center text-sm shadow">
                    🏛️
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-background"></span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs truncate flex items-center gap-1.5">
                      <span>AI Council 관제실</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-mono font-bold">DEV</span>
                    </span>
                    <span className="text-[10px] text-emerald-400 font-mono font-bold">95%</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    Gemini • Cursor
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* 나와의 채팅 (아직 생성 전일 때 빠른 진입 카드) */}
          {!hasSelfChatRoom && !search.trim() && (filter === "all" || filter === "direct") && (
            <div className="px-2 pt-2">
              <button
                type="button"
                onClick={() => void handleOpenSelfChat(false)}
                onDoubleClick={() => void handleOpenSelfChat(true)}
                disabled={startingChatId !== null}
                title="클릭하여 나와의 채팅 열기 · 더블클릭하여 새 창으로 분리"
                className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl border border-teal-500/20 bg-teal-500/5 hover:bg-teal-500/10 transition-colors"
              >
                <div className="h-10 w-10 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                  <NotebookPen className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-bold leading-none">
                      나
                    </span>
                    <span className={cn("text-foreground truncate", messengerType.title)}>
                      나와의 채팅
                    </span>
                  </div>
                  <p className={cn("text-muted-foreground truncate mt-0.5", messengerType.preview)}>
                    개인 메모 · 현장 사진 · 파일 보관함
                  </p>
                </div>
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              대화방 목록을 불러오는 중...
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground px-4">
              <p className="font-medium text-foreground mb-1">대화방이 없습니다.</p>
              <p className={cn("text-muted-foreground/80 mb-3", messengerType.meta)}>
                우측 상단의 [+ 새 대화] 버튼이나 [현장 조직도] 탭에서 대화를 시작해 보세요.
              </p>
            </div>
          ) : (
            <div className="py-1.5 space-y-0.5">
            {filteredRooms.map((room) => {
              const isSelected = room.id === selectedRoomId;
              const isFavorite = favoriteIds.includes(room.id);
              const isSelf = Boolean(room.is_self_chat);
              const title = isSelf
                ? room.custom_name || "나와의 채팅"
                : room.custom_name ||
                  room.name ||
                  (room.is_group
                    ? `그룹 대화 (${room.participants?.length || 0}명)`
                    : room.other_participant?.full_name || "1:1 대화");

              return (
                <div
                  key={room.id}
                  onClick={() => onSelectRoom(room)}
                  onDoubleClick={() => onDoubleClickRoom?.(room)}
                  title="클릭하여 대화방 열기 · 더블클릭하여 새 창으로 분리"
                  className={cn(
                    "group flex items-start gap-3 px-3 py-2.5 mx-1.5 rounded-xl cursor-pointer hover:bg-muted/60 transition-all relative",
                    isSelected && "bg-primary/8 hover:bg-primary/12 ring-1 ring-primary/15",
                  )}
                >
                  {/* 아바타 아이콘 */}
                  <div
                    className={cn(
                      "h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 text-xs font-semibold shadow-2xs",
                      isSelf
                        ? "bg-teal-500/15 text-teal-600 dark:text-teal-400"
                        : room.is_group
                          ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                          : "bg-primary/10 text-primary",
                    )}
                  >
                    {isSelf ? (
                      <NotebookPen className="h-5 w-5" />
                    ) : room.is_group ? (
                      <Users className="h-5 w-5" />
                    ) : (
                      room.other_participant?.full_name?.slice(0, 1) || (
                        <User className="h-5 w-5" />
                      )
                    )}
                  </div>

                  {/* 대화방 메타 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isSelf && (
                          <span className="px-1.5 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-bold leading-none shrink-0">
                            나
                          </span>
                        )}
                        {isFavorite && (
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                        <span className={cn("truncate text-foreground", messengerType.title)}>
                          {title}
                        </span>
                        {room.is_group && (
                          <span className={cn("text-muted-foreground shrink-0 font-normal", messengerType.meta)}>
                            {room.participants?.length || 0}
                          </span>
                        )}
                        {room.notifications_enabled === false && (
                          <span title="알림 꺼짐">
                            <BellOff className="h-3 w-3 text-muted-foreground/70 shrink-0" />
                          </span>
                        )}
                        {room.pinned_message_id && (
                          <span title="고정 공지 있음">
                            <Megaphone className="h-3 w-3 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {onDoubleClickRoom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDoubleClickRoom(room);
                            }}
                            className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity"
                            title="별도 창으로 열기"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => handleToggleFavorite(e, room.id)}
                          className={cn(
                            "p-0.5 rounded hover:bg-muted transition-opacity",
                            isFavorite
                              ? "opacity-100 text-amber-400"
                              : "opacity-0 group-hover:opacity-100 text-muted-foreground",
                          )}
                          title={isFavorite ? "즐겨찾기 해제" : "상단 고정(즐겨찾기)"}
                        >
                          <Star
                            className={cn("h-3 w-3", isFavorite && "fill-amber-400")}
                          />
                        </button>
                        <span className={cn("text-muted-foreground/80", messengerType.meta)}>
                          {formatLastTime(room.last_message_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "truncate",
                          messengerType.preview,
                          room.unread_count && room.unread_count > 0
                            ? "text-foreground font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatCleanRoomPreview(room.last_message_text)}
                      </p>
                      {/* 미확인 뱃지 */}
                      {room.unread_count !== undefined && room.unread_count > 0 && (
                        <span className={cn("h-5 min-w-[20px] px-1 rounded-full bg-red-500 text-white font-bold flex items-center justify-center shrink-0 shadow-xs", messengerType.meta)}>
                          {room.unread_count > 99 ? "99+" : room.unread_count}
                        </span>
                      )}
                    </div>

                    <div className={cn("flex items-center gap-1.5 mt-1 text-muted-foreground/70", messengerType.meta)}>
                      <span className="flex items-center gap-0.5">
                        <ShieldCheck className="h-2.5 w-2.5 text-primary" />
                        {room.project_id ? "현장" : "전사"}
                      </span>
                      {!room.is_group && room.other_participant?.company_name && (
                        <span>· {room.other_participant.company_name}</span>
                      )}
                      {!room.is_group && room.other_participant?.role && (
                        <span>· {room.other_participant.role}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          )}
        </div>
      ) : (
        /* 현장 조직도 (원청 / 협력사 소속별 디렉터리) */
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3">
          {!search.trim() && (
            <button
              type="button"
              onClick={() => void handleOpenSelfChat(false)}
              onDoubleClick={() => void handleOpenSelfChat(true)}
              disabled={startingChatId !== null}
              title={
                onDoubleClickRoom
                  ? "클릭하여 나와의 채팅 열기 · 더블클릭하여 새 창으로 분리"
                  : "나와의 채팅 열기"
              }
              className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl border border-teal-500/25 bg-teal-500/5 hover:bg-teal-500/10 transition-colors"
            >
              <div className="h-9 w-9 rounded-2xl bg-teal-500/15 text-teal-600 dark:text-teal-400 flex items-center justify-center shrink-0">
                <NotebookPen className="h-4.5 w-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded-full bg-teal-600 text-white text-[10px] font-bold leading-none">
                    나
                  </span>
                  <span className={cn("text-foreground truncate", messengerType.title)}>
                    나와의 채팅
                  </span>
                </div>
                <p className={cn("text-muted-foreground truncate mt-0.5", messengerType.meta)}>
                  개인 메모 · 현장 사진 · 파일 보관함
                </p>
              </div>
            </button>
          )}
          {loadingContacts ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              현장 조직도를 불러오는 중...
            </div>
          ) : companyGroups.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              표시할 현장 관리자가 없습니다.
            </div>
          ) : (
            companyGroups.map((group) => (
              <div
                key={group.companyName}
                className="rounded-xl border bg-card overflow-hidden shadow-2xs"
              >
                <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className={cn("truncate text-foreground", messengerType.title)}>
                      {group.companyName}
                    </span>
                    {group.isSameCompany && (
                      <span className={cn("px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold shrink-0", messengerType.meta)}>
                        내 소속
                      </span>
                    )}
                    <span className={cn("text-muted-foreground shrink-0", messengerType.meta)}>
                      ({group.members.length}명)
                    </span>
                  </div>
                  {group.members.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={startingChatId !== null}
                      onClick={() =>
                        void handleStartCompanyGroupChat(group.companyName, group.members)
                      }
                      className={cn("h-8 px-2 gap-1 text-primary hover:text-primary", messengerType.meta)}
                    >
                      <Users className="h-3 w-3" />
                      <span>업체 단체방</span>
                    </Button>
                  )}
                </div>

                <div className="divide-y">
                  {group.members.map((member) => (
                    <div
                      key={member.user_id}
                      onDoubleClick={() => void handleStartDirectChat(member, { popout: true })}
                      title="더블클릭하여 1:1 별도 창으로 열기"
                      className="p-2.5 flex items-center justify-between gap-2 hover:bg-muted/40 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {member.full_name?.slice(0, 1) || <User className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className={cn("text-foreground truncate", messengerType.title)}>
                              {member.full_name || "관리자"}
                            </span>
                            {member.role && (
                              <span className={cn("px-1.5 py-0.2 rounded bg-muted text-muted-foreground shrink-0", messengerType.meta)}>
                                {member.role}
                              </span>
                            )}
                          </div>
                          {member.project_label && (
                            <div className={cn("text-muted-foreground truncate mt-0.5", messengerType.meta)}>
                              {member.project_label}
                            </div>
                          )}
                          {member.phone && (
                            <div className={cn("text-muted-foreground flex items-center gap-1 mt-0.5", messengerType.meta)}>
                              <Phone className="h-2.5 w-2.5 text-primary" />
                              <span>{member.phone}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={startingChatId !== null}
                        onClick={() => void handleStartDirectChat(member)}
                        className={cn("h-8 px-2.5 gap-1 shrink-0", messengerType.meta)}
                      >
                        <MessageCirclePlus className="h-3 w-3" />
                        <span>1:1 대화</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
