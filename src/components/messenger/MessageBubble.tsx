import { useState } from "react";
import type { ChatRoomMessage } from "@/lib/messengerApi";
import { CornerDownLeft, Copy, User } from "lucide-react";
import { toast } from "sonner";
import { ReadReceiptModal } from "./ReadReceiptModal";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatRoomMessage;
  isMe: boolean;
  onReply?: (message: ChatRoomMessage) => void;
  onScrollToMessage?: (messageId: string) => void;
}

export function MessageBubble({
  message,
  isMe,
  onReply,
  onScrollToMessage,
}: MessageBubbleProps) {
  const [showReceipts, setShowReceipts] = useState(false);

  const formatTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    toast.success("메시지가 복사되었습니다.");
  };

  // 시스템 메시지인 경우 중앙 정렬 배너
  if (message.message_type === "SYSTEM") {
    return (
      <div className="flex justify-center my-3">
        <span className="text-[11px] px-3 py-1 rounded-full bg-muted/80 text-muted-foreground border">
          {message.content}
        </span>
      </div>
    );
  }

  return (
    <>
      <div
        id={`msg-${message.id}`}
        className={cn(
          "group flex items-end gap-1.5 my-2.5 max-w-[85%] transition-all",
          isMe ? "ml-auto flex-row-reverse" : "mr-auto flex-row"
        )}
      >
        {/* 상대방 프로필 아바타 (내 메시지가 아닐 때만 표시) */}
        {!isMe && (
          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[11px] font-semibold shrink-0 mb-1">
            {message.sender_name?.slice(0, 1) || <User className="h-3.5 w-3.5" />}
          </div>
        )}

        {/* 메시지 본체 영역 */}
        <div className={cn("flex flex-col min-w-0", isMe ? "items-end" : "items-start")}>
          {/* 상대방 이름 및 소속 회사 */}
          {!isMe && (
            <div className="flex items-center gap-1.5 mb-1 px-1 text-[11px]">
              <span className="font-semibold text-foreground">{message.sender_name || "사용자"}</span>
              {message.sender_company && (
                <span className="text-[10px] text-muted-foreground">· {message.sender_company}</span>
              )}
              {message.sender_role && (
                <span className="text-[9px] px-1 py-0.2 rounded bg-muted text-muted-foreground">
                  {message.sender_role}
                </span>
              )}
            </div>
          )}

          {/* 인용 답장 원본 미리보기 박스 */}
          {message.parent_message && (
            <div
              onClick={() => message.parent_id && onScrollToMessage?.(message.parent_id)}
              className={cn(
                "cursor-pointer text-[11px] p-2 rounded-t-lg border-b border-dashed mb-0.5 max-w-full truncate flex items-center gap-1.5 bg-muted/60 hover:bg-muted text-muted-foreground",
                isMe ? "rounded-tl-lg" : "rounded-tr-lg"
              )}
            >
              <CornerDownLeft className="h-3 w-3 shrink-0" />
              <span className="font-medium text-foreground shrink-0">
                {message.parent_message.sender_name}:
              </span>
              <span className="truncate">{message.parent_message.content}</span>
            </div>
          )}

          {/* 실제 메시지 말풍선 */}
          <div
            className={cn(
              "relative px-3.5 py-2 rounded-2xl text-xs break-words shadow-sm leading-relaxed",
              isMe
                ? "bg-primary text-primary-foreground rounded-br-xs"
                : "bg-card border text-card-foreground rounded-bl-xs"
            )}
          >
            {message.content}

            {/* 마우스 호버 시 답장/복사 퀵 액션 */}
            <div
              className={cn(
                "absolute -top-7 hidden group-hover:flex items-center gap-1 p-0.5 rounded-md bg-background border shadow-sm z-10",
                isMe ? "right-0" : "left-0"
              )}
            >
              {onReply && (
                <button
                  type="button"
                  onClick={() => onReply(message)}
                  className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                  title="답장하기"
                >
                  <CornerDownLeft className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
                title="복사하기"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>

        {/* 시간 및 라인웍스 스타일 읽음 카운트 뱃지 */}
        <div className={cn("flex flex-col items-center justify-end pb-0.5 shrink-0 text-[10px]")}>
          {/* 읽음 카운트 (클릭 시 명단 모달) */}
          <button
            type="button"
            onClick={() => setShowReceipts(true)}
            className="text-amber-500 hover:text-amber-600 font-bold hover:underline mb-0.5 cursor-pointer px-1"
            title="클릭하여 읽은 사람/안 읽은 사람 명단 확인"
          >
            {message.unread_count !== undefined && message.unread_count > 0 ? message.unread_count : ""}
          </button>
          <span className="text-muted-foreground/80 text-[9px] whitespace-nowrap">
            {formatTime(message.created_at)}
          </span>
        </div>
      </div>

      {/* 라인웍스 읽음 확인 모달 */}
      <ReadReceiptModal
        messageId={showReceipts ? message.id : null}
        isOpen={showReceipts}
        onClose={() => setShowReceipts(false)}
      />
    </>
  );
}
