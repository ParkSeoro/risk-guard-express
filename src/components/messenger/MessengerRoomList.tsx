import { useState } from "react";
import type { ChatRoom } from "@/lib/messengerApi";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, MessageSquare, Users, User, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessengerRoomListProps {
  rooms: ChatRoom[];
  selectedRoomId?: string | null;
  onSelectRoom: (room: ChatRoom) => void;
  onOpenNewChat: () => void;
  loading?: boolean;
}

export function MessengerRoomList({
  rooms,
  selectedRoomId,
  onSelectRoom,
  onOpenNewChat,
  loading = false,
}: MessengerRoomListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "direct" | "group">("all");

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

  const filteredRooms = rooms.filter((room) => {
    // 탭 필터
    if (filter === "direct" && room.is_group) return false;
    if (filter === "group" && !room.is_group) return false;

    // 검색어 필터
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const titleMatch = room.name?.toLowerCase().includes(q);
    const otherMatch = room.other_participant?.full_name?.toLowerCase().includes(q);
    const companyMatch = room.other_participant?.company_name?.toLowerCase().includes(q);
    const lastMsgMatch = room.last_message_text?.toLowerCase().includes(q);

    return titleMatch || otherMatch || companyMatch || lastMsgMatch;
  });

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* 헤더 및 새 대화 버튼 (모바일 상태바 safe area 대응) */}
      <div className="p-3 pt-[max(0.75rem,var(--sat))] border-b bg-card shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">메신저</h2>
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

      {/* 검색 및 필터 탭 */}
      <div className="p-2.5 border-b bg-muted/20 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="대화방 또는 참가자 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8 bg-background"
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors",
              filter === "all"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => setFilter("direct")}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors",
              filter === "direct"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            1:1 대화
          </button>
          <button
            type="button"
            onClick={() => setFilter("group")}
            className={cn(
              "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors",
              filter === "group"
                ? "bg-primary text-primary-foreground shadow-2xs"
                : "text-muted-foreground hover:bg-muted"
            )}
          >
            그룹 대화
          </button>
        </div>
      </div>

      {/* 대화방 리스트 */}
      <div className="flex-1 overflow-y-auto divide-y divide-border/60">
        {loading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            대화방 목록을 불러오는 중...
          </div>
        ) : filteredRooms.length === 0 ? (
          <div className="py-16 text-center text-xs text-muted-foreground px-4">
            <p className="font-medium text-foreground mb-1">대화방이 없습니다.</p>
            <p className="text-[11px] text-muted-foreground/80 mb-3">
              우측 상단의 [+ 새 대화] 버튼을 눌러 관리자들과 대화를 시작해 보세요.
            </p>
          </div>
        ) : (
          filteredRooms.map((room) => {
            const isSelected = room.id === selectedRoomId;
            const title =
              room.name ||
              (room.is_group
                ? `그룹 대화 (${room.participants?.length || 0}명)`
                : room.other_participant?.full_name || "1:1 대화");

            return (
              <div
                key={room.id}
                onClick={() => onSelectRoom(room)}
                className={cn(
                  "flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors relative",
                  isSelected && "bg-primary/5 hover:bg-primary/10"
                )}
              >
                {/* 아바타 아이콘 */}
                <div
                  className={cn(
                    "h-10 w-10 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold shadow-2xs",
                    room.is_group
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-primary/10 text-primary"
                  )}
                >
                  {room.is_group ? (
                    <Users className="h-5 w-5" />
                  ) : (
                    room.other_participant?.full_name?.slice(0, 1) || <User className="h-5 w-5" />
                  )}
                </div>

                {/* 대화방 메타 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold truncate text-foreground">
                        {title}
                      </span>
                      {room.is_group && (
                        <span className="text-[10px] text-muted-foreground shrink-0 font-normal">
                          {room.participants?.length || 0}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/80 shrink-0">
                      {formatLastTime(room.last_message_at)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {room.last_message_text || "새 대화방이 생성되었습니다."}
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
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
