import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchRoomMessages,
  sendChatMessage,
  uploadChatFile,
  markChatRoomRead,
  type ChatRoom,
  type ChatRoomMessage,
} from "@/lib/messengerApi";
import { formatBytes } from "@/lib/compressUploadFile";
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
  Paperclip,
  Loader2,
  FileText,
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
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<ChatRoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatRoomMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // 파일 첨부 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // onRoomUpdated 안정적 ref 관리 (리렌더링 루프 방지)
  const onRoomUpdatedRef = useRef(onRoomUpdated);
  useEffect(() => {
    onRoomUpdatedRef.current = onRoomUpdated;
  }, [onRoomUpdated]);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // 메시지 로딩: 로딩 시에는 부모의 onRoomUpdated를 호출하지 않음 (무한 깜박임 루프 방지)
  const loadMessages = useCallback(async () => {
    if (!room.id) return;
    try {
      const msgs = await fetchRoomMessages(room.id);
      setMessages(msgs);
      setLoading(false);
      setTimeout(() => scrollToBottom(false), 50);

      // 대화방 읽음 처리 (DB만 업데이트, 부모 재조회는 유발하지 않음)
      if (msgs.length > 0) {
        await markChatRoomRead(room.id, msgs[msgs.length - 1].id);
      }
    } catch (err) {
      console.error("loadMessages error:", err);
      setLoading(false);
    }
  }, [room.id, scrollToBottom]);

  useEffect(() => {
    setLoading(true);
    loadMessages();
  }, [loadMessages]);

  // Supabase Realtime 메시지 및 타이핑 채널 구독
  useEffect(() => {
    if (!room.id || !user) return;

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
          
          // 작성자 프로필 및 첨부파일 조회
          const [profileRes, attRes] = await Promise.all([
            supabase
              .from("profiles")
              .select("display_name, company, position")
              .eq("user_id", newMsg.sender_id)
              .maybeSingle(),
            supabase
              .from("chat_attachments" as any)
              .select("*")
              .eq("message_id", newMsg.id),
          ]);

          const formattedMsg: ChatRoomMessage = {
            ...newMsg,
            sender_name: profileRes.data?.display_name || "사용자",
            sender_company: profileRes.data?.company || null,
            sender_role: profileRes.data?.position || null,
            attachments: (attRes.data as any) || [],
          };

          setMessages((prev) => {
            if (prev.some((m) => m.id === formattedMsg.id)) return prev;
            return [...prev, formattedMsg];
          });

          // 내가 보낸 메시지가 아니면 읽음 처리 및 부모 목록 갱신
          if (newMsg.sender_id !== user.id) {
            await markChatRoomRead(room.id, newMsg.id);
            onRoomUpdatedRef.current?.();
          }

          setTimeout(() => scrollToBottom(true), 50);
        }
      )
      .subscribe();

    // 타이핑 인디케이터 Broadcast 채널 (DB 부하 0)
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
  }, [room.id, user, scrollToBottom]);

  // 타이핑 전파 (400ms 디바운스)
  const handleTyping = () => {
    if (!user) return;
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

    typingTimeoutRef.current = setTimeout(() => {
      supabase.channel(`typing:${room.id}`).send({
        type: "broadcast",
        event: "typing",
        payload: {
          userId: user.id,
          userName: profile?.display_name || "관리자",
        },
      });
    }, 400);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      toast.error("50MB 이하의 파일만 전송할 수 있습니다.");
      return;
    }

    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFilePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || sending) return;

    const text = inputText;
    const parentId = replyTarget?.id || null;
    const file = selectedFile;

    setInputText("");
    setReplyTarget(null);
    handleClearFile();
    setSending(true);

    try {
      let uploadedAttachment: any = null;

      if (file) {
        setUploadingFile(true);
        uploadedAttachment = await uploadChatFile(file, room.id);
        setUploadingFile(false);

        if (!uploadedAttachment) {
          toast.error("파일 업로드에 실패했습니다.");
          setInputText(text);
          setSelectedFile(file);
          setSending(false);
          return;
        }
      }

      const res = await sendChatMessage(room.id, text, parentId, uploadedAttachment);
      if (!res) {
        toast.error("메시지 전송에 실패했습니다.");
        setInputText(text);
      } else {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.id)) return prev;
          return [
            ...prev,
            {
              ...res,
              sender_name: profile?.display_name || "나",
              sender_company: profile?.company || null,
              sender_role: profile?.position || null,
            },
          ];
        });
        onRoomUpdatedRef.current?.();
      }
    } catch (err: any) {
      toast.error(err?.message || "오류가 발생했습니다.");
      setInputText(text);
    } finally {
      setSending(false);
      setUploadingFile(false);
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
    <div className="flex flex-col h-full w-full bg-background overflow-hidden relative overscroll-contain">
      {/* 대화방 상단 헤더 (모바일 노치 대응 safe-area-inset-top) */}
      <header className="px-3 pt-[max(0.625rem,var(--sat))] pb-2.5 border-b bg-card flex items-center justify-between shrink-0 shadow-xs z-10">
        <div className="flex items-center gap-2 min-w-0">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={onBack}
              title="대화방 목록으로 돌아가기"
              aria-label="뒤로가기"
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
              첫 메시지나 현장 사진을 보내 안전 관리 업무를 공유해 보세요.
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

      {/* 첨부할 파일 미리보기 바 */}
      {selectedFile && (
        <div className="px-3 py-2 bg-muted/90 border-t flex items-center justify-between text-xs animate-in slide-in-from-bottom-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            {filePreviewUrl ? (
              <img
                src={filePreviewUrl}
                alt="미리보기"
                className="h-10 w-10 object-cover rounded border shrink-0"
              />
            ) : (
              <div className="h-10 w-10 rounded border bg-background flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-xs truncate max-w-[200px] sm:max-w-xs">
                {selectedFile.name}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {formatBytes(selectedFile.size)} · 전송 준비 완료
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearFile}
            className="p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground shrink-0"
            title="첨부 취소"
          >
            <X className="h-4 w-4" />
          </button>
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

      {/* 메시지 및 파일 입력창 (모바일 하단 가상키보드/홈바 대응 pb-[max(0.5rem,var(--sab))]) */}
      <div className="p-2.5 pb-[max(0.625rem,var(--sab))] border-t bg-card shrink-0">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.zip"
          className="hidden"
        />

        <div className="flex items-end gap-1.5 bg-background border rounded-xl p-1.5 shadow-2xs focus-within:ring-1 focus-within:ring-primary">
          {/* 사진 및 파일 첨부 버튼 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 mb-0.5 rounded-lg"
            title="사진 또는 파일 첨부"
            aria-label="첨부파일"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedFile ? "설명 메시지를 입력하세요 (선택)..." : "메시지를 입력하세요 (Enter: 전송)"}
            className="min-h-[38px] max-h-24 resize-none border-0 shadow-none focus-visible:ring-0 text-xs p-1.5 leading-relaxed"
            rows={1}
          />

          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedFile) || sending}
            className="h-8 w-8 rounded-lg shrink-0 mb-0.5"
            title="전송"
          >
            {sending || uploadingFile ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
