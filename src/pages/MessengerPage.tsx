import { useEffect, useState, useCallback, useMemo } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";
import { MessageSquare } from "lucide-react";

export default function MessengerPage() {
  const { user, roles, rolesReady } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room");
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // 불변 loadRooms 함수로 무한 깜박임 루프 제거
  const loadRooms = useCallback(async () => {
    try {
      const data = await fetchMyChatRooms();
      setRooms(data);
    } catch (err) {
      console.error("loadRooms error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  // URL query 파라미터 변경 시 선택된 방 동기화
  useEffect(() => {
    if (initialRoomId) {
      setSelectedRoomId(initialRoomId);
    }
  }, [initialRoomId]);

  // 실시간 변경 감지
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("messenger-page-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_room_messages",
        },
        () => {
          loadRooms();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, loadRooms]);

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    return rooms.find((r) => r.id === selectedRoomId) || null;
  }, [rooms, selectedRoomId]);

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoomId(room.id);
    setSearchParams({ room: room.id }, { replace: true });
  };

  const handleBackToList = () => {
    setSelectedRoomId(null);
    setSearchParams({}, { replace: true });
    loadRooms();
  };

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  return (
    <div
      className="flex-1 h-full min-h-0 w-full flex bg-background overflow-hidden overscroll-contain"
    >
      {/* 대화방 목록 패널 (데스크톱 360px 고정, 모바일에서는 선택된 방이 없을 때 전체 너비) */}
      <div
        className={`w-full md:w-80 lg:w-96 border-r flex flex-col shrink-0 h-full min-h-0 ${
          selectedRoomId ? "hidden md:flex" : "flex"
        }`}
      >
        <MessengerRoomList
          rooms={rooms}
          selectedRoomId={selectedRoomId}
          onSelectRoom={handleSelectRoom}
          onOpenNewChat={() => setIsNewChatOpen(true)}
          onRoomCreated={(id) => {
            setSelectedRoomId(id);
            setSearchParams({ room: id });
            loadRooms();
          }}
          currentProjectId={projectAccess?.selectedProject}
          loading={loading}
        />
      </div>

      {/* 대화창 본체 (선택된 방이 있을 때 표시, 없을 때 데스크톱 플레이스홀더) */}
      <div
        className={`flex-1 h-full min-h-0 min-w-0 ${
          selectedRoomId ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedRoom ? (
          <MessengerChatPane
            room={selectedRoom}
            onBack={handleBackToList}
            onRoomUpdated={loadRooms}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-muted/10">
            <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-3">
              <MessageSquare className="h-8 w-8 stroke-1 text-muted-foreground/60" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              대화방을 선택하세요
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              왼쪽 목록에서 대화방을 선택하거나 새 대화를 시작하여 안전 관리 업무를 실시간으로 공유하세요.
            </p>
          </div>
        )}
      </div>

      <NewChatDialog
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onRoomCreated={(id) => {
          setSelectedRoomId(id);
          setSearchParams({ room: id });
          loadRooms();
        }}
        currentProjectId={projectAccess?.selectedProject}
      />
    </div>
  );
}
