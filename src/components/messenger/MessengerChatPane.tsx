import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchRoomMessages,
  sendChatMessage,
  markChatRoomRead,
  type ChatRoom,
  type ChatRoomMessage,
} from "@/lib/messengerApi";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MessageBubble } from "./MessageBubble";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  CornerDownLeft,
  Send,
  Users,
  X,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

interface MessengerChatPaneProps {
  room: ChatRoom;
  onBack?: () => void;
  onRoomUpdated?: () => void;
}

export function MessengerChatPane({
  room,
  onBack,
  onRoomUpdated,
}: MessengerChatPaneProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatRoomMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      const msgs = await fetchRoomMessages(room.id);
      setMessages(msgs);
      setLoading(false);
      setTimeout(() => scrollToBottom(false), 50);

      // 대화방 읽음 처리
      if (msgs.length > 0) {
        await markChatRoomRead(room.id, msgs[msgs.length - 1].id);
        onRoomUpdated?.();
      }
    } catch (err) {
      console.error("loadMessages error:", err);
      setLoading(false);
    }
  }, [room.id, onRoomUpdated, scrollToBottom]);

  useEffect(() => {
    setLoading(true);
    loadMessages();
  }, [loadMessages]);

  // Supabase Realtime 메시지 및 타이핑 채널 구독
  useEffect(() => {
    if (!room.id || !user) return;

    // 1. 메시지 실시간 변경 구독
    const messageChannel = supabase
      .channel(`chat_room_messages:${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_room_messages",
          filter: `room_id=eq.${room.id}`,
        },
        async (payload) => {
          const newMsg = payload.new as any;
          
          // 작성자 프로필 정보 조회
          const { data: profile } = await supabase
            .from("profiles")
            .select("display_name, company, position")
            .eq("user_id", newMsg.sender_id)
            .maybeSingle();

          const formattedMsg: ChatRoomMessage = {
            ...newMsg,
            sender_name: profile?.display_name || "사용자",
            sender_company: profile?.company || null,
            sender_role: profile?.position || null,
          };

          setMessages((prev) => {
            // 중복 방지
            if (prev.some((m) => m.id === formattedMsg.id)) return prev;
            return [...prev, formattedMsg];
          });

          // 내가 보낸 메시지가 아니면 읽음 처리
          if (newMsg.sender_id !== user.id) {
            await markChatRoomRead(room.id, newMsg.id);
            onRoomUpdated?.();
          }

          setTimeout(() => scrollToBottom(true), 50);
        }
      )
      .subscribe();

    // 2. 타이핑 인디케이터 Broadcast 채널 (DB 부하 0)
    const typingChannel = supabase
      .channel(`typing:${room.id}`)
      .on("broadcast", { event: "typing" }, (payload) => {
        const { userName, userId } = payload.payload;
        if (userId === user.id) return;

        setTypingUsers((prev) => Array.from(new Set([...prev, userName])));
        setTimeout(() => {
          setTypingUsers((prev) => prev.filter((name) => name !== userName));
        }, 3000);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(messageChannel);
      supabase.removeChannel(typingChannel);
    };
  }, [room.id, user, onRoomUpdated, scrollToBottom]);

  // 타이핑 전파 (500ms 디바운스)
  const handleTyping = () => {
    if (!user) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      supabase.channel(`typing:${room.id}`).send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: user.id,
          userName: (user.user_metadata as any)?.display_name || "관리자",
        },
      });
    }, 400);
  };

  const handleSend = async () => {
    if (!inputText.trim() || sending) return;

    const text = inputText;
    const parentId = replyTarget?.id || null;

    setInputText("");
    setReplyTarget(null);
    setSending(true);

    try {
      const res = await sendChatMessage(room.id, text, parentId);
      if (!res) {
        toast.error("메시지 전송에 실패했습니다.");
        setInputText(text); // 복구
      } else {
        onRoomUpdated?.();
      }
    } catch (err: any) {
      toast.error(err?.message || "오류가 발생했습니다.");
      setInputText(text);
    } finally {
      setSending(false);
      setTimeout(() => scrollToBottom(true), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const scrollToMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-primary/10", "rounded-lg");
      setTimeout(() => {
        el.classList.remove("bg-primary/10", "rounded-lg");
      }, 1500);
    } else {
      toast.info("이전 메시지입니다.");
    }
  };

  const roomTitle =
    room.name ||
    (room.is_group
      ? `그룹 대화 (${room.participants?.length || 0}명)`
      : room.other_participant?.full_name || "1:1 대화방");

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative">
      {/* 대화방 상단 헤더 */}
      <header className="h-13 px-3 border-b bg-card flex items-center justify-between shrink-0 shadow-xs z-10">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onBack}
              title="대화방 목록"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-xs sm:text-sm font-semibold truncate text-foreground">
                {roomTitle}
              </h2>
              {room.is_group && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground flex items-center gap-0.5 shrink-0">
                  <Users className="h-3 w-3" />
                  {room.participants?.length || 0}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
              <ShieldCheck className="h-2.5 w-2.5 text-primary" />
              {room.project_id ? "현장 관리자 대화방" : "전사 통합 대화방"}
            </p>
          </div>
        </div>
      </header>

      {/* 메시지 리스트 뷰포트 */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            메시지를 불러오는 중...
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <Users className="h-10 w-10 stroke-1 mb-2 text-muted-foreground/60" />
            <p className="text-xs font-medium">대화가 시작되었습니다.</p>
            <p className="text-[11px] mt-1 text-muted-foreground/80">
              첫 메시지를 보내 안전 관리 업무를 공유해 보세요.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isMe={msg.sender_id === user?.id}
              onReply={(m) => setReplyTarget(m)}
              onScrollToMessage={scrollToMessage}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 상대방 입력 중 표시 (Supabase Broadcast) */}
      {typingUsers.length > 0 && (
        <div className="px-3 py-1 bg-muted/40 text-[10px] text-muted-foreground italic flex items-center gap-1.5 shrink-0 border-t border-dashed">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
          {typingUsers.join(", ")}님이 입력 중입니다...
        </div>
      )}

      {/* 인용 답장 미리보기 배너 */}
      {replyTarget && (
        <div className="px-3 py-1.5 bg-muted/80 border-t flex items-center justify-between text-xs animate-in slide-in-from-bottom-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CornerDownLeft className="h-3.5 w-3.5 text-primary shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-[11px] text-foreground mr-1.5">
                {replyTarget.sender_name}님에게 답장:
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                {replyTarget.content}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyTarget(null)}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 메시지 입력창 */}
      <div className="p-2.5 border-t bg-card shrink-0">
        <div className="flex items-end gap-1.5 bg-background border rounded-xl p-1.5 shadow-2xs focus-within:ring-1 focus-within:ring-primary">
          <Textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요 (Enter: 전송, Shift+Enter: 줄바꿈)"
            className="min-h-[38px] max-h-24 resize-none border-0 shadow-none focus-visible:ring-0 text-xs p-1.5 leading-relaxed"
            rows={1}
          />
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={!inputText.trim() || sending}
            className="h-8 w-8 rounded-lg shrink-0 mb-0.5"
            title="전송"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
