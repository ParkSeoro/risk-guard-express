import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  fetchMyChatRooms,
  sendChatMessage,
  type ChatRoom,
  type ChatRoomMessage,
} from "@/lib/messengerApi";
import { forwardChatParts, messengerType } from "@/lib/messengerType";

export function MessengerForwardDialog({
  message,
  currentRoomId,
  open,
  onClose,
}: {
  message: ChatRoomMessage | null;
  currentRoomId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetchMyChatRooms()
      .then((list) => {
        if (!cancelled) setRooms(list.filter((room) => room.id !== currentRoomId));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentRoomId]);

  const sendTo = async (room: ChatRoom) => {
    if (!message || sendingId) return;
    setSendingId(room.id);
    try {
      for (const part of forwardChatParts(message)) {
        const sent = await sendChatMessage(room.id, part.content, null, part.attachment);
        if (!sent) {
          toast.error("전달하지 못했습니다.");
          return;
        }
      }
      toast.success("다른 대화방으로 전달했습니다.");
      onClose();
    } finally {
      setSendingId(null);
    }
  };

  const titleOf = (room: ChatRoom) =>
    room.custom_name || room.name || room.other_participant?.full_name || "대화방";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className={messengerType.title}>전달할 대화방</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className={messengerType.preview}>대화방을 불러오는 중...</div>
        ) : rooms.length === 0 ? (
          <p className={messengerType.preview}>전달할 다른 대화방이 없습니다.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {rooms.map((room) => (
              <Button
                key={room.id}
                type="button"
                variant="ghost"
                className={`w-full justify-start h-auto py-2 ${messengerType.title}`}
                disabled={!!sendingId}
                onClick={() => void sendTo(room)}
              >
                {sendingId === room.id && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="truncate">{titleOf(room)}</span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
