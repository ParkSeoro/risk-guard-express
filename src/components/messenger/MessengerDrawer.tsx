import { useEffect, useState, useCallback, useMemo } from "react";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList } from "./MessengerRoomList";
import { MessengerChatPane } from "./MessengerChatPane";
import { NewChatDialog } from "./NewChatDialog";
import { Button } from "@/components/ui/button";
import { Maximize2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { messengerHomePath } from "@/lib/messengerPath";
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
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // loadRooms: 의존성 없는 완전한 불변 함수로 무한 리렌더링 제거
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
    if (isOpen) {
      loadRooms();
    }
  }, [isOpen, loadRooms]);

  // 실시간 대화방 갱신 구독
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

  const selectedRoom = useMemo(() => {
    if (!selectedRoomId) return null;
    return rooms.find((r) => r.id === selectedRoomId) || null;
  }, [rooms, selectedRoomId]);

  const handleSelectRoom = (room: ChatRoom) => {
    setSelectedRoomId(room.id);
  };

  const handleRoomCreated = async (roomId: string) => {
    await loadRooms();
    setSelectedRoomId(roomId);
  };

  const handleExpandToPage = () => {
    onClose();
    const base = messengerHomePath();
    if (selectedRoomId) {
      navigate(`${base}?room=${selectedRoomId}`);
    } else {
      navigate(base);
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

      {/* 우측 슬라이드 드로어 본체 (모바일 safe-area 및 h-dvh 완벽 대응) */}
      <div className="fixed top-0 right-0 bottom-0 w-full sm:w-[420px] md:w-[460px] h-dvh bg-background border-l shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-250 overscroll-contain">
        {/* 상단 통합 제어 바 */}
        <div className="h-11 px-3 pt-[max(0.25rem,var(--sat))] border-b bg-muted/40 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-muted-foreground">
            SafeNex 실시간 비즈니스 메신저
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleExpandToPage}
              title="전체화면으로 보기"
              aria-label="전체화면"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="닫기"
              aria-label="닫기"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 본문 (목록 또는 채팅방) */}
        <div className="flex-1 min-h-0 flex flex-col">
          {selectedRoom ? (
            <MessengerChatPane
              room={selectedRoom}
              onBack={() => {
                setSelectedRoomId(null);
                loadRooms();
              }}
              onRoomUpdated={loadRooms}
            />
          ) : (
            <MessengerRoomList
              rooms={rooms}
              selectedRoomId={selectedRoomId}
              onSelectRoom={handleSelectRoom}
              onOpenNewChat={() => setIsNewChatOpen(true)}
              onRoomCreated={handleRoomCreated}
              currentProjectId={currentProjectId}
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
