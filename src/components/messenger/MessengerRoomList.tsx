import { useEffect, useMemo, useState } from "react";
import {
  createChatRoom,
  fetchChatContacts,
  getFavoriteRoomIds,
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface MessengerRoomListProps {
  rooms: ChatRoom[];
  selectedRoomId?: string | null;
  onSelectRoom: (room: ChatRoom) => void;
  onOpenNewChat: () => void;
  onRoomCreated?: (roomId: string) => void;
  currentProjectId?: string | null;
  loading?: boolean;
}

export function MessengerRoomList({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onOpenNewChat,
  onRoomCreated,
  currentProjectId,
  loading = false,
}: MessengerRoomListProps) {
  const [activeTab, setActiveTab] = useState<"rooms" | "directory">("rooms");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "favorite" | "direct" | "group">("all");
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => getFavoriteRoomIds());

  // 현장 조직도 탭 상태
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [startingChatId, setStartingChatId] = useState<string | null>(null);

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

    // 즐겨찾기 고정된 대화방을 최상단에 배치
    return [...list].sort((a, b) => {
      const aFav = favSet.has(a.id);
      const bFav = favSet.has(b.id);
      if (aFav !== bFav) return aFav ? -1 : 1;
      const aTime = a.last_message_at || a.created_at || "";
      const bTime = b.last_message_at || b.created_at || "";
      return bTime.localeCompare(aTime);
    });
  }, [rooms, filter, search, favoriteIds]);

  const companyGroups = useMemo(() => groupContactsByCompany(contacts), [contacts]);

  const handleToggleFavorite = (e: React.MouseEvent, roomId: string) => {
    e.stopPropagation();
    setFavoriteIds(toggleFavoriteRoomId(roomId));
  };

  const handleStartDirectChat = async (contact: ChatContact) => {
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
        onRoomCreated?.(roomId);
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
      {/* 헤더 및 새 대화 버튼 */}
      <div className="p-3 pt-[max(0.75rem,var(--sat))] border-b bg-card shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">SafeNex 메신저</h2>
        </div>
        <Button
          size="sm"
          onClick={onOpenNewChat}
          className="h-7 px-2.5 text-xs gap-1 shadow-2xs"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>새 대화</span>
        </Button>
      </div>

      {/* 상단 2탭 전환: 대화방 | 현장 조직도 */}
      <div className="grid grid-cols-2 border-b bg-muted/30 shrink-0 p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("rooms")}
          className={cn(
            "py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors",
            activeTab === "rooms"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>대화방</span>
          {unreadRoomsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-red-500 text-white text-[10px] font-bold">
              {unreadRoomsCount}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("directory")}
          className={cn(
            "py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors",
            activeTab === "directory"
              ? "bg-background text-foreground shadow-2xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Building2 className="h-3.5 w-3.5" />
          <span>현장 조직도</span>
        </button>
      </div>

      {/* 검색 및 필터 바 */}
      <div className="p-2.5 border-b bg-muted/20 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={
              activeTab === "rooms"
                ? "대화방, 참가자, 업체명 검색..."
                : "조직도에서 이름 또는 소속 업체 검색..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8 bg-background"
          />
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
                  "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors shrink-0",
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
          {loading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              대화방 목록을 불러오는 중...
            </div>
          ) : filteredRooms.length === 0 ? (
            <div className="py-16 text-center text-xs text-muted-foreground px-4">
              <p className="font-medium text-foreground mb-1">대화방이 없습니다.</p>
              <p className="text-[11px] text-muted-foreground/80 mb-3">
                우측 상단의 [+ 새 대화] 버튼이나 [현장 조직도] 탭에서 대화를 시작해 보세요.
              </p>
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isSelected = room.id === selectedRoomId;
              const isFavorite = favoriteIds.includes(room.id);
              const title =
                room.custom_name ||
                room.name ||
                (room.is_group
                  ? `그룹 대화 (${room.participants?.length || 0}명)`
                  : room.other_participant?.full_name || "1:1 대화");

              return (
                <div
                  key={room.id}
                  onClick={() => onSelectRoom(room)}
                  className={cn(
                    "group flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors relative",
                    isSelected && "bg-primary/5 hover:bg-primary/10",
                  )}
                >
                  {/* 아바타 아이콘 */}
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold shadow-2xs",
                      room.is_group
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-primary/10 text-primary",
                    )}
                  >
                    {room.is_group ? (
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
                      <div className="flex items-center gap-1 min-w-0">
                        {isFavorite && (
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400 shrink-0" />
                        )}
                        <span className="text-xs font-semibold truncate text-foreground">
                          {title}
                        </span>
                        {room.is_group && (
                          <span className="text-[10px] text-muted-foreground shrink-0 font-normal">
                            {room.participants?.length || 0}
                          </span>
                        )}
                        {room.notifications_enabled === false && (
                          <BellOff
                            className="h-3 w-3 text-muted-foreground/70 shrink-0"
                            title="알림 꺼짐"
                          />
                        )}
                        {room.pinned_message_id && (
                          <Megaphone
                            className="h-3 w-3 text-amber-500 shrink-0"
                            title="고정 공지 있음"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
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
                        <span className="text-[10px] text-muted-foreground/80">
                          {formatLastTime(room.last_message_at)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "text-xs truncate",
                          room.unread_count && room.unread_count > 0
                            ? "text-foreground font-medium"
                            : "text-muted-foreground",
                        )}
                      >
                        {formatCleanRoomPreview(room.last_message_text)}
                      </p>
                      {/* 미확인 뱃지 */}
                      {room.unread_count !== undefined && room.unread_count > 0 && (
                        <span className="h-4.5 min-w-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-xs">
                          {room.unread_count > 99 ? "99+" : room.unread_count}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground/70">
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
            })
          )}
        </div>
      ) : (
        /* 현장 조직도 (원청 / 협력사 소속별 디렉터리) */
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-3">
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
                    <span className="text-xs font-bold truncate text-foreground">
                      {group.companyName}
                    </span>
                    {group.isSameCompany && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-primary/10 text-primary font-semibold shrink-0">
                        내 소속
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground shrink-0">
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
                      className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary"
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
                      className="p-2.5 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0">
                          {member.full_name?.slice(0, 1) || <User className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-foreground truncate">
                              {member.full_name || "관리자"}
                            </span>
                            {member.role && (
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground shrink-0">
                                {member.role}
                              </span>
                            )}
                          </div>
                          {member.project_label && (
                            <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                              {member.project_label}
                            </div>
                          )}
                          {member.phone && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
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
                        className="h-7 px-2.5 text-[11px] gap-1 shrink-0"
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
