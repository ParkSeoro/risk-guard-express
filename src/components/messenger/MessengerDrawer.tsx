import { useEffect, useState, useCallback } from "react";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "./MessengerRoomList";
import { MessengerChatPane } from "./MessengerChatPane";
import { NewChatDialog } from "./NewChatDialog";
import { Button } from "@/components/ui/button";
import { Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface MessengerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectId?: string | null;
}

export function MessengerDrawer({
  isOpen,
  onClose,
  currentProjectId,
}: MessengerDrawerProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<ChatRoom | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadRooms = useCallback(async () => {
    try {
      const data = await fetchMyChatRooms();
      setRooms(data);
      // 만약 선택된 방이 있다면 데이터 동기화
      if (selectedRoom) {
        const updated = data.find((r) => r.id === selectedRoom.id);
        if (updated) setSelectedRoom(updated);
      }
    } catch (err) {
      console.error("loadRooms error:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedRoom]);

  useEffect(() => {
    if (isOpen) {
      loadRooms();
    }
  }, [isOpen, loadRooms]);

  // 실시간 대화방 갱신 구독 (새 메시지 도착 시 목록 상단 갱신)
  useEffect(() => {
    if (!isOpen || !user) return;

    const channel = supabase
      .channel("drawer-rooms-realtime")
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
  }, [isOpen, user, loadRooms]);

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoom(room);
  };

  const handleRoomCreated = async (roomId: string) => {
    await loadRooms();
    const target = rooms.find((r) => r.id === roomId);
    if (target) {
      setSelectedRoom(target);
    }
  };

  const handleExpandToPage = () => {
    onClose();
    if (selectedRoom) {
      navigate(`/app/messenger?room=${selectedRoom.id}`);
    } else {
      navigate("/app/messenger");
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* 딤 배경 (클릭 시 닫기) */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-2xs z-40 transition-opacity animate-in fade-in"
      />

      {/* 우측 슬라이드 드로어 본체 */}
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[420px] md:w-[460px] bg-background border-l shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-250">
        {/* 상단 통합 제어 바 */}
        <div className="h-10 px-3 border-b bg-muted/40 flex items-center justify-between shrink-0">
          <span className="text-[11px] font-medium text-muted-foreground">
            SafeNex 실시간 비즈니스 메신저
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleExpandToPage}
              title="전체화면으로 보기"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="닫기"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 본문 (목록 또는 채팅방) */}
        <div className="flex-1 min-h-0 relative">
          {selectedRoom ? (
            <MessengerChatPane
              room={selectedRoom}
              onBack={() => {
                setSelectedRoom(null);
                loadRooms();
              }}
              onRoomUpdated={loadRooms}
            />
          ) : (
            <MessengerRoomList
              rooms={rooms}
              selectedRoomId={selectedRoom?.id}
              onSelectRoom={handleSelectRoom}
              onOpenNewChat={() => setIsNewChatOpen(true)}
              loading={loading}
            />
          )}
        </div>
      </div>

      {/* 새 대화 개설 다이얼로그 */}
      <NewChatDialog
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onRoomCreated={handleRoomCreated}
        currentProjectId={currentProjectId}
      />
    </>
  );
}
