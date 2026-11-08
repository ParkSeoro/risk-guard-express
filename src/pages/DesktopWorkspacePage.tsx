import { useEffect, useState, useCallback, useMemo } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { AiCouncilChatPane } from "@/components/messenger/AiCouncilChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";
import {
  isWindowsDesktopApp,
  openDesktopPopoutWindow,
  openSafeNexWebSite,
  resizeDesktopWindow,
  setDesktopShellActive,
} from "@/lib/desktopBridge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquare, Users, Plus, Globe, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export default function DesktopWorkspacePage() {
  const navigate = useNavigate();
  const { user, roles, rolesReady } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomParam = searchParams.get("room");
  const tabParam = searchParams.get("tab");
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(roomParam);
  const [messengerTab, setMessengerTab] = useState<"directory" | "rooms" | "council">(
    roomParam === "dev-ai-council" || tabParam === "council"
      ? "council"
      : roomParam || tabParam === "rooms"
        ? "rooms"
        : "directory",
  );
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);

  useEffect(() => {
    setDesktopShellActive(true);
  }, []);

  // 좌측 아이콘 레일에서 대화상대(?tab=directory) / 대화목록(?tab=rooms) / AI의회(?tab=council) 클릭 시 동기화
  useEffect(() => {
    if (roomParam === "dev-ai-council" || tabParam === "council") {
      setSelectedRoomId("dev-ai-council");
      setMessengerTab("council");
    } else if (roomParam) {
      setSelectedRoomId(roomParam);
      setMessengerTab("rooms");
    } else if (tabParam === "rooms") {
      setSelectedRoomId(null);
      setMessengerTab("rooms");
    } else if (tabParam === "directory") {
      setSelectedRoomId(null);
      setMessengerTab("directory");
    }
  }, [roomParam, tabParam]);

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

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadRooms]);

  const totalUnreadChats = useMemo(
    () => rooms.reduce((sum, r) => sum + (r.unread_count || 0), 0),
    [rooms],
  );

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    return rooms.find((r) => r.id === selectedRoomId) || null;
  }, [rooms, selectedRoomId]);

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoomId(room.id);
    if (room.id === "dev-ai-council") {
      setMessengerTab("council");
      setSearchParams({ tab: "council", room: "dev-ai-council" }, { replace: true });
    } else {
      setMessengerTab("rooms");
      setSearchParams({ tab: "rooms", room: room.id }, { replace: true });
    }
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
      width: 400,
      height: 640,
      windowName: `safenex_chat_${room.id}`,
    });
  };

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  const isRoomViewOpen =
    selectedRoomId === "dev-ai-council" ||
    messengerTab === "council" ||
    Boolean(selectedRoom && messengerTab === "rooms");

  return (
    <div className="flex-1 min-w-0 h-full min-h-0 w-full flex flex-col bg-background overflow-hidden select-none">
      {/* 상단 컴팩트 바 (목록 화면에서만 표시하여 대화방/관제실 진입 시 웹·앱 화면 높이를 100% 일치시킴) */}
      {!isRoomViewOpen && (
      <header className="px-3 pt-2.5 pb-2 border-b bg-card flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            {projectAccess && projectAccess.projects.length > 0 ? (
              <Select
                value={projectAccess.selectedProject}
                onValueChange={projectAccess.setSelectedProject}
              >
                <SelectTrigger className="h-8 text-sm font-bold border-0 bg-muted/60 hover:bg-muted px-2.5 rounded-lg max-w-[210px] truncate shadow-none">
                  <SelectValue placeholder="현장 선택" />
                </SelectTrigger>
                <SelectContent>
                  {projectAccess.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-base font-bold text-foreground truncate">
                SafeNex 메신저
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!isWindowsDesktopApp() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => navigate("/app/admin")}
                className="h-7 px-2 text-sm gap-1 rounded-lg text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                title="일반 전체 관리자 대시보드로 돌아가기"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>관리자 홈</span>
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openSafeNexWebSite("/app/admin")}
              className="h-7 px-2 text-sm gap-1 rounded-lg text-primary border-primary/30 hover:bg-primary/10"
              title="SafeNex 전체 웹 사이트 바로가기 (기본 브라우저 열기)"
            >
              <Globe className="h-3.5 w-3.5" />
              <span>사이트</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setIsNewChatOpen(true)}
              className="h-7 px-2.5 text-sm gap-1 rounded-lg"
              title="새 대화"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>새 대화</span>
            </Button>
          </div>
        </div>

        {/* 상단 탭: [대화상대] | [대화목록] */}
        <div className="grid grid-cols-2 rounded-lg bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => {
              setMessengerTab("directory");
              setSelectedRoomId(null);
              setSearchParams({ tab: "directory" }, { replace: true });
            }}
            className={cn(
              "py-2 rounded-md text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
              messengerTab === "directory" && !selectedRoomId
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
              setSelectedRoomId(null);
              setSearchParams({ tab: "rooms" }, { replace: true });
            }}
            className={cn(
              "py-2 rounded-md text-sm font-bold flex items-center justify-center gap-1.5 transition-all",
              messengerTab === "rooms"
                ? "bg-background text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>대화목록</span>
            {totalUnreadChats > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-[#ff3b30] text-white text-xs font-extrabold">
                {totalUnreadChats > 99 ? "99+" : totalUnreadChats}
              </span>
            )}
          </button>
        </div>
      </header>
      )}

      {/* 본문: AI Council 또는 대화상대/대화목록 또는 선택된 채팅방 */}
      <div className="flex-1 min-h-0 min-w-0 w-full flex overflow-hidden">
        {selectedRoomId === "dev-ai-council" || messengerTab === "council" ? (
          <AiCouncilChatPane
            onBack={() => {
              setSelectedRoomId(null);
              setMessengerTab("rooms");
              setSearchParams({ tab: "rooms" }, { replace: true });
              void loadRooms();
            }}
          />
        ) : selectedRoom && messengerTab === "rooms" ? (
          <MessengerChatPane
            room={selectedRoom}
            onBack={() => {
              setSelectedRoomId(null);
              setSearchParams({ tab: "rooms" }, { replace: true });
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
                setSearchParams({ tab: "rooms", room: id }, { replace: true });
                void loadRooms();
              }}
              currentProjectId={projectAccess?.selectedProject}
              loading={loadingRooms}
              forcedTab={messengerTab}
              onTabChange={(t) => {
                setMessengerTab(t);
                setSearchParams({ tab: t }, { replace: true });
              }}
              hideHeader
              hideTopTabs
            />
          </div>
        )}
      </div>

      <NewChatDialog
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onRoomCreated={(id) => {
          setSelectedRoomId(id);
          setMessengerTab("rooms");
          setSearchParams({ tab: "rooms", room: id }, { replace: true });
          void loadRooms();
        }}
        currentProjectId={projectAccess?.selectedProject}
      />
    </div>
  );
}
