import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MessageSquare } from "lucide-react";

export default function MessengerPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room");
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadRooms = useCallback(async () => {
    try {
      const data = await fetchMyChatRooms();
      setRooms(data);

      if (initialRoomId) {
        const found = data.find((r) => r.id === initialRoomId);
        if (found) setSelectedRoom(found);
      } else if (selectedRoom) {
        const updated = data.find((r) => r.id === selectedRoom.id);
        if (updated) setSelectedRoom(updated);
      }
    } catch (err) {
      console.error("loadRooms error:", err);
    } finally {
      setLoading(false);
    }
  }, [initialRoomId, selectedRoom]);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

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

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoom(room);
    setSearchParams({ room: room.id }, { replace: true });
  };

  const handleBackToList = () => {
    setSelectedRoom(null);
    setSearchParams({}, { replace: true });
    loadRooms();
  };

  return (
    <div className="h-[calc(100vh-3.5rem)] w-full flex bg-background overflow-hidden">
      {/* 대화방 목록 패널 (데스크톱에서는 좌측 360px 고정, 모바일에서는 선택된 방이 없을 때 전체 너비) */}
      <div
        className={`w-full md:w-80 lg:w-96 border-r flex flex-col shrink-0 h-full ${
          selectedRoom ? "hidden md:flex" : "flex"
        }`}
      >
        <MessengerRoomList
          rooms={rooms}
          selectedRoomId={selectedRoom?.id}
          onSelectRoom={handleSelectRoom}
          onOpenNewChat={() => setIsNewChatOpen(true)}
          loading={loading}
        />
      </div>

      {/* 대화창 본체 (선택된 방이 있을 때 표시, 없을 때 데스크톱 플레이스홀더) */}
      <div
        className={`flex-1 h-full min-w-0 ${
          selectedRoom ? "flex" : "hidden md:flex"
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
          setSearchParams({ room: id });
          loadRooms();
        }}
        currentProjectId={projectAccess?.selectedProject}
      />
    </div>
  );
}
