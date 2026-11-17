import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { fetchMyChatRooms, type ChatRoom } from "@/lib/messengerApi";
import { MessengerRoomList, DEV_COUNCIL_ROOM } from "@/components/messenger/MessengerRoomList";
import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import { AiCouncilChatPane } from "@/components/messenger/AiCouncilChatPane";
import { NewChatDialog } from "@/components/messenger/NewChatDialog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";
import { canOpenCouncil } from "@/lib/councilAccess";
import { clearMessengerPickerActive, readMessengerPickerState } from "@/lib/messengerPath";
import { Capacitor } from "@capacitor/core";
import { openDesktopPopoutWindow } from "@/lib/desktopBridge";
import { useMessengerLock } from "@/hooks/useMessengerLock";
import {
  MessengerLockScreen,
  MessengerLockSettingsDialog,
} from "@/components/messenger/MessengerLockOverlay";
import { MessageSquare } from "lucide-react";

export default function MessengerPage() {
  const { user, roles, rolesReady } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialRoomId = searchParams.get("room") || readMessengerPickerState()?.roomId || null;
  const projectAccess = useGlobalProjectAccessOptional();

  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoomId);
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const cachedRoomRef = useRef<ChatRoom | null>(null);
  const {
    lockState,
    setLockState,
    settingsOpen,
    setSettingsOpen,
    lockNow,
    unlock,
    isLockConfigured,
  } = useMessengerLock(user?.id);

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

  // URL query 파라미터 변경 시 선택된 방 동기화 (뒤로가기로 ?room= 해제 시 목록으로 복귀)
  const urlRoomId = searchParams.get("room");
  useEffect(() => {
    if (urlRoomId === "dev-ai-council" && !canOpenCouncil(user)) {
      setSelectedRoomId(null);
      setSearchParams({}, { replace: true });
      return;
    }
    if (urlRoomId) {
      clearMessengerPickerActive();
      setSelectedRoomId(urlRoomId);
      return;
    }
    const pickerRoomId = readMessengerPickerState()?.roomId;
    if (pickerRoomId) {
      clearMessengerPickerActive();
      setSelectedRoomId(pickerRoomId);
      setSearchParams({ room: pickerRoomId }, { replace: true });
      return;
    }
    setSelectedRoomId(null);
  }, [urlRoomId, user, setSearchParams]);

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
    if (!selectedRoomId) {
      cachedRoomRef.current = null;
      return null;
    }
    const found = rooms.find((r) => r.id === selectedRoomId) || null;
    if (found) {
      cachedRoomRef.current = found;
      return found;
    }
    if (cachedRoomRef.current?.id === selectedRoomId) {
      return cachedRoomRef.current;
    }
    return null;
  }, [rooms, selectedRoomId]);

  const handleSelectRoom = (room: ChatRoom) => {
    const wasInRoom = Boolean(selectedRoomId);
    cachedRoomRef.current = room;
    setSelectedRoomId(room.id);
    setSearchParams({ room: room.id }, { replace: wasInRoom });
  };

  const handleBackToList = () => {
    clearMessengerPickerActive();
    cachedRoomRef.current = null;
    setSelectedRoomId(null);
    setSearchParams({}, { replace: true });
    loadRooms();
  };

  const handlePopoutRoom = (room: ChatRoom) => {
    const title = room.is_self_chat
      ? "나와의 채팅"
      : room.custom_name ||
        room.name ||
        room.other_participant?.full_name ||
        "SafeNex 대화방";
    openDesktopPopoutWindow({
      url: `${window.location.origin}/app/admin/messenger?room=${room.id}&popout=1`,
      title: `SafeNex - ${title}`,
      width: 440,
      height: 700,
      windowName: `safenex_chat_${room.id}`,
    });
  };

  if (rolesReady && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/today" replace />;
  }

  return (
    <div
      className="relative flex-1 h-full min-h-0 w-full flex bg-background overflow-hidden overscroll-contain"
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
          onDoubleClickRoom={Capacitor.isNativePlatform() ? undefined : handlePopoutRoom}
          onOpenNewChat={() => setIsNewChatOpen(true)}
          onRoomCreated={(id) => {
            setSelectedRoomId(id);
            setSearchParams({ room: id });
            loadRooms();
          }}
          currentProjectId={projectAccess?.selectedProject}
          loading={loading}
          onLockNow={lockNow}
          onOpenLockSettings={() => setSettingsOpen(true)}
          isLockConfigured={isLockConfigured}
        />
      </div>

      {/* 대화창 본체 (선택된 방이 있을 때 표시, 없을 때 데스크톱 플레이스홀더) */}
      <div
        className={`flex-1 h-full min-h-0 min-w-0 ${
          selectedRoomId ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedRoomId === "dev-ai-council" && canOpenCouncil(user) ? (
          <AiCouncilChatPane onBack={handleBackToList} />
        ) : selectedRoom ? (
          <MessengerChatPane
            room={selectedRoom}
            onBack={handleBackToList}
            onRoomUpdated={loadRooms}
          />
        ) : loading && selectedRoomId ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground bg-muted/10">
            대화방을 불러오는 중...
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-slate-50/70 dark:bg-slate-950/40">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4 shadow-sm">
              <MessageSquare className="h-8 w-8 stroke-1.5" />
            </div>
            <h3 className="text-base font-bold text-foreground">
              SafeNex 현장 메신저
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-sm leading-relaxed">
              대화방을 클릭해 바로 소통하거나, 대화방·담당자를 <span className="font-semibold text-foreground">더블클릭</span>해 별도 창으로 띄워 작업하세요.
            </p>
            <p className="text-xs text-muted-foreground/80 mt-2">
              상단「나와의 채팅」으로 개인 메모·사진도 간편하게 보관할 수 있습니다.
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

      {user?.id && (
        <MessengerLockSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          userId={user.id}
          lockState={lockState}
          onSaved={setLockState}
        />
      )}

      {user?.id && lockState.locked && (
        <MessengerLockScreen
          userId={user.id}
          userName={user.user_metadata?.full_name || user.email}
          onUnlocked={unlock}
        />
      )}
    </div>
  );
}
