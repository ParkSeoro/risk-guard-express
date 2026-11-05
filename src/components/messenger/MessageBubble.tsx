import { useMemo, useRef, useState } from "react";
import type { ChatRoomMessage, ChatAttachment } from "@/lib/messengerApi";
import {
  parseSafetyDocMessage,
  QUICK_CHAT_REACTIONS,
  safetyDocAppPath,
  type SafetyDocCardPayload,
} from "@/lib/chatMessages";
import { canonicalizeAppPath } from "@/lib/notificationRoutes";
import { formatBytes } from "@/lib/compressUploadFile";
import {
  CornerDownLeft,
  Copy,
  User,
  FileText,
  Download,
  ExternalLink,
  Pin,
  Trash2,
  ClipboardCheck,
  ShieldAlert,
  FileCheck2,
  ArrowUpRight,
  Forward,
} from "lucide-react";
import { toast } from "sonner";
import { ReadReceiptModal } from "./ReadReceiptModal";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { messengerType } from "@/lib/messengerType";
import { cn } from "@/lib/utils";

interface MessageBubbleProps {
  message: ChatRoomMessage;
  isMe: boolean;
  currentUserId?: string | null;
  showDateDivider?: boolean;
  dateLabel?: string;
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  isPinned?: boolean;
  highlightQuery?: string;
  onReply?: (message: ChatRoomMessage) => void;
  onScrollToMessage?: (messageId: string) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
  onPinMessage?: (message: ChatRoomMessage) => void;
  onDeleteMessage?: (message: ChatRoomMessage) => void;
  onForward?: (message: ChatRoomMessage) => void;
  onOpenImage?: (url: string) => void;
}

const DOC_KIND_META: Record<
  SafetyDocCardPayload["kind"],
  { label: string; badgeClass: string; Icon: typeof FileCheck2 }
> = {
  work_permit: {
    label: "작업허가서",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    Icon: ShieldAlert,
  },
  assessment_run: {
    label: "위험성평가",
    badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    Icon: ClipboardCheck,
  },
  work_plan: {
    label: "작업계획서",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    Icon: FileCheck2,
  },
  tbm_session: {
    label: "TBM 일지",
    badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
    Icon: FileText,
  },
};

export function MessageBubble({
  message,
  isMe,
  currentUserId,
  showDateDivider = false,
  dateLabel = "",
  isFirstInGroup = true,
  isLastInGroup = true,
  isPinned = false,
  highlightQuery = "",
  onReply,
  onScrollToMessage,
  onToggleReaction,
  onPinMessage,
  onDeleteMessage,
  onForward,
  onOpenImage,
}: MessageBubbleProps) {
  const [showReceipts, setShowReceipts] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);

  const openImage = (url: string) => {
    if (onOpenImage) onOpenImage(url);
    else setLightboxUrl(url);
  };

  const startPress = () => {
    longPressed.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      setActionsOpen(true);
    }, 450);
  };

  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  const parsedDoc = useMemo(
    () => parseSafetyDocMessage(message.content || ""),
    [message.content],
  );

  const reactionGroups = useMemo(() => {
    const list = message.reactions || [];
    if (list.length === 0) return [];
    const map = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
    for (const r of list) {
      const existing = map.get(r.emoji);
      const isMine = Boolean(currentUserId && r.user_id === currentUserId);
      if (existing) {
        existing.count += 1;
        if (isMine) existing.reactedByMe = true;
      } else {
        map.set(r.emoji, { emoji: r.emoji, count: 1, reactedByMe: isMine });
      }
    }
    return Array.from(map.values());
  }, [message.reactions, currentUserId]);

  const handleCopy = () => {
    navigator.clipboard.writeText(parsedDoc.summaryText || message.content);
    toast.success("메시지가 복사되었습니다.");
  };

  const attachments: ChatAttachment[] = message.attachments || [];
  const isSearchMatch =
    Boolean(highlightQuery.trim()) &&
    (parsedDoc.summaryText || message.content || "")
      .toLowerCase()
      .includes(highlightQuery.trim().toLowerCase());

  return (
    <>
      {/* 날짜 구분선 (카카오워크 / 네이버웍스 스타일) */}
      {showDateDivider && dateLabel && (
        <div className="flex items-center justify-center my-4 select-none">
          <div className="h-px flex-1 bg-border/60" />
          <span className={cn("mx-3 font-medium px-3 py-0.5 rounded-full bg-muted/70 text-muted-foreground border border-border/60", messengerType.meta)}>
            {dateLabel}
          </span>
          <div className="h-px flex-1 bg-border/60" />
        </div>
      )}

      {/* 시스템 메시지인 경우 중앙 정렬 배너 */}
      {message.message_type === "SYSTEM" ? (
        <div className="flex justify-center my-2.5">
          <span className={cn("px-3 py-1 rounded-full bg-muted/80 text-muted-foreground border", messengerType.meta)}>
            {message.content}
          </span>
        </div>
      ) : (
        <div
          id={`msg-${message.id}`}
          className={cn(
            "group flex items-end gap-1.5 max-w-[88%] sm:max-w-[80%] transition-all",
            isFirstInGroup ? "mt-2.5" : "mt-0.5",
            isLastInGroup ? "mb-1.5" : "mb-0",
            isMe ? "ml-auto flex-row-reverse" : "mr-auto flex-row",
            isSearchMatch && "ring-2 ring-amber-400/80 rounded-xl p-1 bg-amber-500/5",
          )}
        >
          {/* 상대방 프로필 아바타 (연속 메시지의 첫 줄에만 표시, 나머지는 여백 유지) */}
          {!isMe && (
            <div className="w-8 shrink-0 flex flex-col items-center self-start mt-0.5">
              {isFirstInGroup ? (
                <div className={cn("h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold border border-primary/20 shadow-2xs", messengerType.meta)}>
                  {message.sender_name?.slice(0, 1) || <User className="h-3.5 w-3.5" />}
                </div>
              ) : (
                <div className="h-1 w-8" />
              )}
            </div>
          )}

          {/* 메시지 본체 영역 */}
          <div className={cn("flex flex-col min-w-0", isMe ? "items-end" : "items-start")}>
            {/* 상대방 이름 및 소속 회사 (연속 메시지의 첫 줄에만 표시) */}
            {!isMe && isFirstInGroup && (
              <div className={cn("flex items-center gap-1.5 mb-1 px-0.5 flex-wrap", messengerType.preview)}>
                <span className="font-semibold text-foreground">
                  {message.sender_name || "사용자"}
                </span>
                {message.sender_company && (
                  <span className={cn("text-muted-foreground font-medium", messengerType.meta)}>
                    · {message.sender_company}
                  </span>
                )}
                {message.sender_role && (
                  <span className={cn("px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-medium border border-border/50", messengerType.meta)}>
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
                  "cursor-pointer px-2.5 py-1.5 rounded-t-xl border border-b-0 mb-0.5 max-w-full truncate flex items-center gap-1.5 bg-muted/70 hover:bg-muted text-muted-foreground transition-colors",
                  messengerType.meta,
                  isMe ? "rounded-tl-xl" : "rounded-tr-xl",
                )}
              >
                <CornerDownLeft className="h-3 w-3 shrink-0 text-primary" />
                <span className="font-semibold text-foreground shrink-0">
                  {message.parent_message.sender_name}:
                </span>
                <span className="truncate">
                  {parseSafetyDocMessage(message.parent_message.content).summaryText}
                </span>
              </div>
            )}

            {/* 실제 메시지 말풍선 */}
            <div
              className={cn(
                "relative px-3.5 py-2.5 rounded-2xl break-words shadow-2xs",
                messengerType.body,
                isMe
                  ? "bg-primary text-primary-foreground rounded-br-xs"
                  : "bg-card border text-card-foreground rounded-bl-xs",
                isPinned && "ring-1 ring-amber-400/60",
              )}
              onPointerDown={startPress}
              onPointerUp={endPress}
              onPointerLeave={endPress}
              onPointerCancel={endPress}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (longPressed.current) {
                  longPressed.current = false;
                  return;
                }
                if (target.closest("a, button, img")) return;
                setActionsOpen(true);
              }}
            >
              {/* 첨부파일 렌더링 */}
              {attachments.length > 0 && (
                <div className="space-y-2 mb-2">
                  {attachments.map((att) => {
                    const isImage = att.mime_type.startsWith("image/");
                    return isImage ? (
                      <div
                        key={att.id}
                        className="rounded-lg overflow-hidden border bg-background/50 cursor-pointer max-w-[280px]"
                        onClick={() => att.public_url && openImage(att.public_url)}
                      >
                        <img
                          src={att.thumbnail_url || att.public_url || ""}
                          alt={att.file_name}
                          className="w-full max-h-56 object-cover hover:opacity-95 transition-opacity"
                          loading="lazy"
                        />
                        <div className={cn("p-1 px-2 text-muted-foreground flex items-center justify-between bg-background/80", messengerType.meta)}>
                          <span className="truncate max-w-[180px]">{att.file_name}</span>
                          <span className="shrink-0">{formatBytes(att.file_size)}</span>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={att.id}
                        className={cn(
                          "flex items-center gap-2 p-2.5 rounded-lg border max-w-[260px]",
                          isMe
                            ? "bg-primary-foreground/10 text-primary-foreground border-white/20"
                            : "bg-muted/40 text-foreground",
                        )}
                      >
                        <FileText className="h-7 w-7 shrink-0 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className={cn("font-medium truncate", messengerType.preview)}>{att.file_name}</p>
                          <p className={cn("opacity-75", messengerType.meta)}>{formatBytes(att.file_size)}</p>
                        </div>
                        {att.public_url && (
                          <a
                            href={att.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            download={att.file_name}
                            className={cn(
                              "p-1.5 rounded-md hover:bg-black/10 transition-colors shrink-0",
                              isMe ? "text-primary-foreground" : "text-foreground",
                            )}
                            title="다운로드"
                          >
                            <Download className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* SafeNex 안전문서 공유 카드 렌더링 */}
              {parsedDoc.card ? (
                <div className="space-y-2">
                  {parsedDoc.card.note && (
                    <div className="whitespace-pre-wrap mb-1.5">{parsedDoc.card.note}</div>
                  )}
                  <div
                    className={cn(
                      "rounded-xl border p-3 min-w-[230px] max-w-[300px] shadow-xs transition-colors",
                      isMe
                        ? "bg-background text-foreground border-border/80"
                        : "bg-muted/30 text-foreground border-border",
                    )}
                  >
                    {(() => {
                      const meta = DOC_KIND_META[parsedDoc.card.kind] || DOC_KIND_META.work_permit;
                      const Icon = meta.Icon;
                      const docPath = safetyDocAppPath(parsedDoc.card);
                      return (
                        <>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span
                              className={cn(
                                "font-bold px-2 py-0.5 rounded-full border inline-flex items-center gap-1",
                                messengerType.meta,
                                meta.badgeClass,
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {meta.label}
                            </span>
                            {parsedDoc.card.statusLabel && (
                              <span className={cn("px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium", messengerType.meta)}>
                                {parsedDoc.card.statusLabel}
                              </span>
                            )}
                          </div>
                          <p className={cn("font-bold text-foreground line-clamp-2", messengerType.preview)}>
                            {parsedDoc.card.title}
                          </p>
                          {parsedDoc.card.subtitle && (
                            <p className={cn("text-muted-foreground mt-0.5 truncate", messengerType.meta)}>
                              {parsedDoc.card.subtitle}
                            </p>
                          )}
                          {docPath ? (
                            <a
                              href={canonicalizeAppPath(docPath)}
                              className={cn("mt-2.5 w-full inline-flex items-center justify-center gap-1 font-semibold py-1.5 px-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors", messengerType.meta)}
                            >
                              <span>안전문서 바로 열기</span>
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                message.content && (
                  <div className="whitespace-pre-wrap">{message.content}</div>
                )
              )}

            </div>

            {/* 이모지 리액션 배지 목록 */}
            {reactionGroups.length > 0 && (
              <div
                className={cn(
                  "flex items-center flex-wrap gap-1 mt-1",
                  isMe ? "justify-end" : "justify-start",
                )}
              >
                {reactionGroups.map((rx) => (
                  <button
                    key={rx.emoji}
                    type="button"
                    onClick={() => onToggleReaction?.(message.id, rx.emoji)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold border transition-colors cursor-pointer",
                      messengerType.meta,
                      rx.reactedByMe
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "bg-muted/60 border-border text-muted-foreground hover:bg-muted",
                    )}
                    title="클릭하여 공감 표시/해제"
                  >
                    <span>{rx.emoji}</span>
                    <span>{rx.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 시간 및 실시간 미확인 카운트 뱃지 */}
          <div
            className={cn(
              "flex flex-col justify-end pb-0.5 shrink-0",
              messengerType.meta,
              isMe ? "items-end" : "items-start",
            )}
          >
            {/* 읽음 카운트 (클릭 시 명단 및 재알림 모달) */}
            <button
              type="button"
              onClick={() => setShowReceipts(true)}
              className={cn(
                "font-bold hover:underline mb-0.5 cursor-pointer px-0.5 leading-none",
                message.unread_count !== undefined && message.unread_count > 0
                  ? "text-amber-500 hover:text-amber-600"
                  : "text-muted-foreground/70 hover:text-foreground font-medium",
              )}
              title="읽은 사람 / 안 읽은 사람 확인 및 재알림"
            >
              {message.unread_count !== undefined && message.unread_count > 0
                ? message.unread_count
                : "읽음"}
            </button>
            {isLastInGroup && (
              <span className="text-muted-foreground/80 whitespace-nowrap leading-none">
                {formatTime(message.created_at)}
              </span>
            )}
          </div>
        </div>
      )}

      <Dialog open={actionsOpen} onOpenChange={setActionsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className={messengerType.title}>메시지</DialogTitle>
          </DialogHeader>
          {onToggleReaction && (
            <div className="flex flex-wrap gap-2">
              {QUICK_CHAT_REACTIONS.map((item) => (
                <Button
                  key={item.emoji}
                  type="button"
                  variant="outline"
                  className={messengerType.preview}
                  onClick={() => {
                    setActionsOpen(false);
                    onToggleReaction(message.id, item.emoji);
                  }}
                >
                  {item.emoji} {item.label}
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-2">
            {onReply && (
              <Button type="button" variant="outline" className={cn("justify-start", messengerType.body)} onClick={() => { setActionsOpen(false); onReply(message); }}>
                <CornerDownLeft className="h-4 w-4" /> 답장
              </Button>
            )}
            <Button type="button" variant="outline" className={cn("justify-start", messengerType.body)} onClick={() => { setActionsOpen(false); handleCopy(); }}>
              <Copy className="h-4 w-4" /> 복사
            </Button>
            {onPinMessage && (
              <Button type="button" variant="outline" className={cn("justify-start", messengerType.body)} onClick={() => { setActionsOpen(false); onPinMessage(message); }}>
                <Pin className="h-4 w-4" /> {isPinned ? "공지 해제" : "공지"}
              </Button>
            )}
            {onForward && (
              <Button type="button" variant="outline" className={cn("justify-start", messengerType.body)} onClick={() => { setActionsOpen(false); onForward(message); }}>
                <Forward className="h-4 w-4" /> 전달
              </Button>
            )}
            {isMe && onDeleteMessage && (
              <Button type="button" variant="outline" className={cn("justify-start text-destructive", messengerType.body)} onClick={() => { setActionsOpen(false); onDeleteMessage(message); }}>
                <Trash2 className="h-4 w-4" /> 삭제
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 라인웍스 읽음 확인 및 미확인자 재알림 모달 */}
      <ReadReceiptModal
        messageId={showReceipts ? message.id : null}
        isOpen={showReceipts}
        onClose={() => setShowReceipts(false)}
      />

      {/* 이미지 라이트박스 팝업 */}
      {lightboxUrl && (
        <Dialog open={!!lightboxUrl} onOpenChange={(open) => !open && setLightboxUrl(null)}>
          <DialogContent className="max-w-3xl p-1 bg-black/95 border-0 flex flex-col items-center justify-center">
            <img
              src={lightboxUrl}
              alt="확대 이미지"
              className="max-h-[85vh] max-w-full object-contain rounded"
            />
            <div className={cn("py-2 flex items-center justify-between w-full px-4 text-white/80", messengerType.meta)}>
              <span>현장 첨부 사진</span>
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-white"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                원본 열기
              </a>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
