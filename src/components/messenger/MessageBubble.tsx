import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { ChatRoomMessage, ChatAttachment } from "@/lib/messengerApi";
import {
  parseSafetyDocMessage,
  CHAT_REACTION_CHOICES,
  CHAT_REACTION_TABS,
  safetyDocAppPath,
  type ChatReactionTabId,
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
  CheckCircle,
  Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  markApprovalNotificationsAsRead,
  markRelatedNotificationsAsRead,
} from "@/lib/notificationReadHelper";
import { toast } from "sonner";
import { ReadReceiptModal } from "./ReadReceiptModal";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  const [reactionTab, setReactionTab] = useState<ChatReactionTabId>("site");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [approvingCardId, setApprovingCardId] = useState<string | null>(null);
  const [approvedCardIds, setApprovedCardIds] = useState<Set<string>>(() => new Set());
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const handleQuickApprove = async (card: SafetyDocCardPayload) => {
    if (approvingCardId || approvedCardIds.has(card.id)) return;
    const ok = window.confirm(`[${card.title}] 문서를 메신저에서 즉시 승인하시겠습니까?`);
    if (!ok) return;

    setApprovingCardId(card.id);
    try {
      const { data: stepRows } = await supabase
        .from("approvals")
        .select("id, status")
        .eq("entity_id", card.id)
        .eq("status", "대기")
        .limit(1);

      const pendingStep = stepRows?.[0];
      if (pendingStep) {
        const { error } = await supabase.rpc("act_on_approval", {
          _approval_id: pendingStep.id,
          _action: "approve",
          _comment: "SafeNex 메신저 1-클릭 신속 승인",
        });
        if (error) throw error;
      } else {
        const { error: entityErr } = await supabase.rpc("act_on_entity_approval", {
          _approval_id: card.id,
          _action: "approve",
          _comment: "SafeNex 메신저 1-클릭 신속 승인",
        });
        if (entityErr) throw entityErr;
      }

      setApprovedCardIds((prev) => new Set([...prev, card.id]));
      if (currentUserId) {
        void markApprovalNotificationsAsRead(currentUserId);
        void markRelatedNotificationsAsRead(currentUserId, card.id);
      }
      toast.success("메신저에서 승인 처리가 완료되었습니다.");
    } catch (err: any) {
      toast.error(err?.message || "승인 처리에 실패했습니다. 결재 권한을 확인해 주세요.");
    } finally {
      setApprovingCardId(null);
    }
  };

  const openImage = (url: string) => {
    if (onOpenImage) onOpenImage(url);
    else setLightboxUrl(url);
  };

  const startPress = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    longPressed.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    const x = event.clientX;
    const y = event.clientY;
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      bubbleRef.current?.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 2,
        }),
      );
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

            {/* 실제 메시지 말풍선. 메뉴는 우클릭(휴대폰은 길게 누르기)으로만 연다. */}
            <ContextMenu onOpenChange={(open) => { if (open) setReactionTab("site"); }}>
            <ContextMenuTrigger asChild>
            <div
              ref={bubbleRef}
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
              onClickCapture={(event) => {
                if (!longPressed.current) return;
                longPressed.current = false;
                event.preventDefault();
                event.stopPropagation();
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
                            {approvedCardIds.has(parsedDoc.card.id) ? (
                              <span className={cn("px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold border border-emerald-500/30", messengerType.meta)}>
                                승인 완료
                              </span>
                            ) : parsedDoc.card.statusLabel ? (
                              <span className={cn("px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium", messengerType.meta)}>
                                {parsedDoc.card.statusLabel}
                              </span>
                            ) : null}
                          </div>
                          <p className={cn("font-bold text-foreground line-clamp-2", messengerType.preview)}>
                            {parsedDoc.card.title}
                          </p>
                          {parsedDoc.card.subtitle && (
                            <p className={cn("text-muted-foreground mt-0.5 truncate", messengerType.meta)}>
                              {parsedDoc.card.subtitle}
                            </p>
                          )}
                          <div className="mt-2.5 pt-2 border-t border-border/60 flex items-center gap-1.5">
                            {docPath && (
                              <a
                                href={canonicalizeAppPath(docPath)}
                                className={cn("flex-1 inline-flex items-center justify-center gap-1 font-semibold py-1.5 px-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors", messengerType.meta)}
                              >
                                <span>상세 열람</span>
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {!approvedCardIds.has(parsedDoc.card.id) && (
                              <button
                                type="button"
                                disabled={approvingCardId === parsedDoc.card.id}
                                onClick={() => void handleQuickApprove(parsedDoc.card)}
                                className={cn("inline-flex items-center justify-center gap-1 font-semibold py-1.5 px-2.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-colors disabled:opacity-50", messengerType.meta)}
                              >
                                {approvingCardId === parsedDoc.card.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-3.5 w-3.5" />
                                )}
                                <span>1-클릭 승인</span>
                              </button>
                            )}
                          </div>
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
            </ContextMenuTrigger>
            <ContextMenuContent className="w-[17.5rem]">
              {onToggleReaction && (
                <>
                  <div className="grid grid-cols-4 gap-1 px-1 pt-1" role="tablist" aria-label="반응 종류">
                    {CHAT_REACTION_TABS.map((tab) => (
                      <ContextMenuItem
                        key={tab.id}
                        role="tab"
                        aria-selected={reactionTab === tab.id}
                        className={cn(
                          "h-7 justify-center px-1",
                          messengerType.meta,
                          reactionTab === tab.id && "bg-primary/15 font-semibold text-primary",
                        )}
                        onSelect={(event) => {
                          event.preventDefault();
                          setReactionTab(tab.id);
                        }}
                      >
                        {tab.label}
                      </ContextMenuItem>
                    ))}
                  </div>
                  <div className="grid grid-cols-8 gap-0.5 px-1 py-1">
                    {CHAT_REACTION_CHOICES[reactionTab].map((item) => (
                      <ContextMenuItem
                        key={item.emoji}
                        className="h-8 w-8 justify-center p-0 text-lg"
                        title={item.label}
                        aria-label={item.label}
                        onSelect={() => onToggleReaction(message.id, item.emoji)}
                      >
                        {item.emoji}
                      </ContextMenuItem>
                    ))}
                  </div>
                  <ContextMenuSeparator />
                </>
              )}
              {onReply && (
                <ContextMenuItem onSelect={() => onReply(message)}>
                  <CornerDownLeft className="mr-2 h-4 w-4" /> 답장
                </ContextMenuItem>
              )}
              <ContextMenuItem onSelect={handleCopy}>
                <Copy className="mr-2 h-4 w-4" /> 복사
              </ContextMenuItem>
              {onPinMessage && (
                <ContextMenuItem onSelect={() => onPinMessage(message)}>
                  <Pin className="mr-2 h-4 w-4" /> {isPinned ? "공지 해제" : "공지"}
                </ContextMenuItem>
              )}
              {onForward && (
                <ContextMenuItem onSelect={() => onForward(message)}>
                  <Forward className="mr-2 h-4 w-4" /> 전달
                </ContextMenuItem>
              )}
              {isMe && onDeleteMessage && (
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onDeleteMessage(message)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> 삭제
                </ContextMenuItem>
              )}
            </ContextMenuContent>
            </ContextMenu>

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
