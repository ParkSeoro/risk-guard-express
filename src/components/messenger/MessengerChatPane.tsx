import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  fetchRoomMessages,
  sendChatMessage,
  uploadChatFile,
  markChatRoomRead,
  setChatNotificationEnabled,
  toggleChatReaction,
  setChatPinnedMessage,
  fetchPinnedMessagePreview,
  deleteMyChatMessage,
  type ChatRoom,
  type ChatRoomMessage,
  type ChatParticipant,
} from "@/lib/messengerApi";
import {
  CHAT_HISTORY_JUMP_MAX_PAGES,
  annotateTimelineMessages,
  computeMessageUnreadCount,
  encodeSafetyDocMessage,
  mergeChatMessages,
  parseSafetyDocMessage,
  type SafetyDocCardPayload,
} from "@/lib/chatMessages";
import { formatBytes } from "@/lib/compressUploadFile";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MessageBubble } from "./MessageBubble";
import { MessengerRoomDrawer } from "./MessengerRoomDrawer";
import { ShareSafetyDocModal } from "./ShareSafetyDocModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Bell,
  BellOff,
  CornerDownLeft,
  Send,
  Users,
  X,
  ShieldCheck,
  Paperclip,
  Loader2,
  FileText,
  Megaphone,
  Search,
  PanelRightOpen,
  FileCheck2,
  UploadCloud,
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
  const [participants, setParticipants] = useState<ChatParticipant[]>(room.participants || []);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<ChatRoomMessage | null>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    room.notifications_enabled !== false,
  );
  const [muteSaving, setMuteSaving] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  // 상단 공지 고정 상태
  const [pinnedMessageId, setPinnedMessageId] = useState<string | null>(
    room.pinned_message_id || null,
  );
  const [pinnedPreview, setPinnedPreview] = useState<{
    id: string;
    content: string;
    sender_name: string;
  } | null>(null);

  // 대화방 내 검색, 우측 서랍, 안전문서 공유 모달, 드래그 앤 드롭 상태
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isShareDocOpen, setIsShareDocOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // 파일 첨부 상태
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasMoreRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const oldestRef = useRef<{ createdAt: string; id: string } | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingScrollRestore = useRef<{ height: number; top: number } | null>(null);

  // onRoomUpdated 안정적 ref 관리 (리렌더링 루프 방지)
  const onRoomUpdatedRef = useRef(onRoomUpdated);
  useEffect(() => {
    onRoomUpdatedRef.current = onRoomUpdated;
  }, [onRoomUpdated]);

  useEffect(() => {
    setParticipants(room.participants || []);
  }, [room.id, room.participants]);

  useEffect(() => {
    setPinnedMessageId(room.pinned_message_id || null);
  }, [room.id, room.pinned_message_id]);

  // 고정 공지 메시지 로드
  useEffect(() => {
    if (!pinnedMessageId) {
      setPinnedPreview(null);
      return;
    }
    const inMemory = messages.find((m) => m.id === pinnedMessageId && !m.is_deleted);
    if (inMemory) {
      setPinnedPreview({
        id: inMemory.id,
        content: parseSafetyDocMessage(inMemory.content).summaryText,
        sender_name: inMemory.sender_name || "관리자",
      });
      return;
    }
    setPinnedPreview((prev) => {
      if (prev?.id === pinnedMessageId) return prev;
      if (typeof fetchPinnedMessagePreview === "function") {
        fetchPinnedMessagePreview(pinnedMessageId).then((res) => {
          if (res) {
            setPinnedPreview({
              ...res,
              content: parseSafetyDocMessage(res.content).summaryText,
            });
          } else {
            setPinnedPreview(null);
          }
        });
      }
      return prev;
    });
  }, [pinnedMessageId, messages]);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    setNotificationsEnabled(room.notifications_enabled !== false);
  }, [room.id, room.notifications_enabled]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const apply = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset > 80 ? Math.round(inset) : 0);
    };
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply);
    apply();
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
    };
  }, []);

  useEffect(() => {
    const first = messages[0];
    oldestRef.current = first ? { createdAt: first.created_at, id: first.id } : null;
  }, [messages]);

  useLayoutEffect(() => {
    const pending = pendingScrollRestore.current;
    const node = listRef.current;
    if (!pending || !node) return;
    pendingScrollRestore.current = null;
    node.scrollTop = pending.top + (node.scrollHeight - pending.height);
  }, [messages]);

  // 메시지 로딩
  const loadMessages = useCallback(async () => {
    if (!room.id) return;
    try {
      const page = await fetchRoomMessages(room.id);
      hasMoreRef.current = page.hasMore;
      setHasMore(page.hasMore);
      setMessages(page.messages);
      stickToBottomRef.current = true;
      setLoading(false);
      setTimeout(() => scrollToBottom(false), 50);

      // 대화방 읽음 처리
      const latest = page.messages[page.messages.length - 1];
      if (latest) {
        await markChatRoomRead(room.id, latest.id);
      }
    } catch (err) {
      console.error("loadMessages error:", err);
      setLoading(false);
    }
  }, [room.id, scrollToBottom]);

  const loadOlder = useCallback(
    async (options?: { restoreScroll?: boolean }) => {
      if (loadingOlderRef.current || !hasMoreRef.current) return false;
      const before = oldestRef.current;
      if (!before) return false;

      loadingOlderRef.current = true;
      setLoadingOlder(true);
      const node = listRef.current;
      if (options?.restoreScroll !== false && node) {
        pendingScrollRestore.current = { height: node.scrollHeight, top: node.scrollTop };
      }

      try {
        const page = await fetchRoomMessages(room.id, { before });
        if (page.messages.length === 0) {
          hasMoreRef.current = false;
          setHasMore(false);
          pendingScrollRestore.current = null;
          return false;
        }
        const oldestIncoming = page.messages[0];
        if (oldestIncoming) {
          oldestRef.current = {
            createdAt: oldestIncoming.created_at,
            id: oldestIncoming.id,
          };
        }
        setMessages((prev) => mergeChatMessages(prev, page.messages));
        hasMoreRef.current = page.hasMore;
        setHasMore(page.hasMore);
        return true;
      } catch (err) {
        console.error("loadOlder error:", err);
        pendingScrollRestore.current = null;
        return false;
      } finally {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [room.id],
  );

  useEffect(() => {
    setLoading(true);
    setIsDrawerOpen(false);
    setIsSearchOpen(false);
    setSearchQuery("");
    loadMessages();
  }, [loadMessages]);

  // Supabase Realtime 메시지, 참여자 읽음 시각(last_read_at), 리액션, 타이핑 구독
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
            reactions: [],
          };

          setMessages((prev) => {
            if (prev.some((m) => m.id === formattedMsg.id)) return prev;
            const parent = newMsg.parent_id
              ? prev.find((m) => m.id === newMsg.parent_id)
              : null;
            const withParent: ChatRoomMessage = parent
              ? {
                  ...formattedMsg,
                  parent_message: {
                    id: parent.id,
                    sender_name: parent.sender_name ?? null,
                    content: parent.content,
                  },
                }
              : formattedMsg;
            return mergeChatMessages(prev, [withParent]);
          });

          if (newMsg.sender_id !== user.id) {
            await markChatRoomRead(room.id, newMsg.id);
            onRoomUpdatedRef.current?.();
          }

          if (stickToBottomRef.current || newMsg.sender_id === user.id) {
            setTimeout(() => scrollToBottom(true), 50);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_room_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.is_deleted) {
            setMessages((prev) => prev.filter((m) => m.id !== updated.id));
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_participants",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const updatedPart = payload.new as any;
          if (!updatedPart?.user_id) return;
          setParticipants((prev) =>
            prev.map((p) =>
              p.user_id === updatedPart.user_id
                ? {
                    ...p,
                    last_read_at: updatedPart.last_read_at || p.last_read_at,
                    left_at: updatedPart.left_at ?? p.left_at,
                  }
                : p,
            ),
          );
        },
      )
      .subscribe();

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

  const attachFile = useCallback((file: File) => {
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
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    attachFile(file);
  };

  // 클립보드 이미지 붙여넣기 (Ctrl+V)
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          e.preventDefault();
          const ext = blob.type.split("/")[1] || "png";
          const file = new File([blob], `clipboard_${Date.now()}.${ext}`, {
            type: blob.type,
          });
          attachFile(file);
          toast.info("클립보드 이미지가 첨부되었습니다.");
          return;
        }
      }
    }
  };

  // 드래그 앤 드롭 업로드
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      attachFile(file);
    }
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    setFilePreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSend = async (overrideContent?: string) => {
    const rawContent = overrideContent !== undefined ? overrideContent : inputText;
    if ((!rawContent.trim() && !selectedFile) || sending) return;

    const text = rawContent;
    const parentSnapshot = replyTarget;
    const parentId = parentSnapshot?.id || null;
    const file = overrideContent !== undefined ? null : selectedFile;

    if (overrideContent === undefined) {
      setInputText("");
      setReplyTarget(null);
      handleClearFile();
    }
    setSending(true);

    try {
      let uploadedAttachment: any = null;

      if (file) {
        setUploadingFile(true);
        uploadedAttachment = await uploadChatFile(file, room.id);
        setUploadingFile(false);

        if (!uploadedAttachment) {
          toast.error("파일 업로드에 실패했습니다.");
          if (overrideContent === undefined) {
            setInputText(text);
            setSelectedFile(file);
          }
          setSending(false);
          return;
        }
      }

      const res = await sendChatMessage(room.id, text, parentId, uploadedAttachment);
      if (!res) {
        toast.error("메시지 전송에 실패했습니다.");
        if (overrideContent === undefined) setInputText(text);
      } else {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.id)) return prev;
          return mergeChatMessages(prev, [
            {
              ...res,
              sender_name: profile?.display_name || "나",
              sender_company: profile?.company || null,
              sender_role: profile?.position || null,
              parent_message: parentSnapshot
                ? {
                    id: parentSnapshot.id,
                    sender_name: parentSnapshot.sender_name ?? null,
                    content: parentSnapshot.content,
                  }
                : res.parent_message ?? null,
            },
          ]);
        });
        stickToBottomRef.current = true;
        onRoomUpdatedRef.current?.();
      }
    } catch (err: any) {
      toast.error(err?.message || "오류가 발생했습니다.");
      if (overrideContent === undefined) setInputText(text);
    } finally {
      setSending(false);
      setUploadingFile(false);
      setTimeout(() => scrollToBottom(true), 50);
    }
  };

  const handleShareSafetyDoc = async (doc: SafetyDocCardPayload) => {
    const encoded = encodeSafetyDocMessage(doc);
    await handleSend(encoded);
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || typeof toggleChatReaction !== "function") return;

    // 낙관적 업데이트 (즉시 반영)
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const current = m.reactions || [];
        const hasMine = current.some((r) => r.user_id === user.id && r.emoji === emoji);
        const nextReactions = hasMine
          ? current.filter((r) => !(r.user_id === user.id && r.emoji === emoji))
          : [
              ...current,
              {
                id: `temp-${Date.now()}`,
                message_id: messageId,
                user_id: user.id,
                emoji,
                created_at: new Date().toISOString(),
              },
            ];
        return { ...m, reactions: nextReactions };
      }),
    );

    const res = await toggleChatReaction(messageId, emoji);
    if (!res) {
      toast.error("공감 반응을 저장하지 못했습니다.");
    }
  };

  const handlePinMessage = async (msg: ChatRoomMessage) => {
    if (typeof setChatPinnedMessage !== "function") return;
    const isAlreadyPinned = pinnedMessageId === msg.id;
    const nextId = isAlreadyPinned ? null : msg.id;
    const ok = await setChatPinnedMessage(room.id, nextId);
    if (ok) {
      setPinnedMessageId(nextId);
      toast.success(nextId ? "대화방 상단 공지로 고정했습니다." : "공지 고정을 해제했습니다.");
      onRoomUpdatedRef.current?.();
    } else {
      toast.error("공지 설정에 실패했습니다.");
    }
  };

  const handleDeleteMessage = async (msg: ChatRoomMessage) => {
    if (typeof deleteMyChatMessage !== "function") return;
    if (!window.confirm("이 메시지를 삭제하시겠습니까?")) return;
    const ok = await deleteMyChatMessage(msg.id);
    if (ok) {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
      if (pinnedMessageId === msg.id) setPinnedMessageId(null);
      toast.success("메시지를 삭제했습니다.");
      onRoomUpdatedRef.current?.();
    } else {
      toast.error("메시지 삭제에 실패했습니다.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const highlightMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("bg-primary/10", "rounded-lg");
    setTimeout(() => {
      el.classList.remove("bg-primary/10", "rounded-lg");
    }, 1500);
    return true;
  };

  const scrollToMessage = async (messageId: string) => {
    if (highlightMessage(messageId)) return;

    for (let page = 0; page < CHAT_HISTORY_JUMP_MAX_PAGES; page += 1) {
      const loaded = await loadOlder({ restoreScroll: false });
      if (!loaded) break;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (highlightMessage(messageId)) return;
    }
    toast.info("이전 메시지를 찾지 못했습니다.");
  };

  const handleListScroll = () => {
    const node = listRef.current;
    if (!node || loading) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
    const canScroll = node.scrollHeight > node.clientHeight + 8;
    if (canScroll && node.scrollTop < 48) void loadOlder();
  };

  const handleToggleNotifications = async () => {
    if (muteSaving) return;
    const next = !notificationsEnabled;
    setNotificationsEnabled(next);
    setMuteSaving(true);
    const ok = await setChatNotificationEnabled(room.id, next);
    setMuteSaving(false);
    if (!ok) {
      setNotificationsEnabled(!next);
      toast.error("알림 설정을 바꾸지 못했습니다.");
      return;
    }
    toast.success(next ? "이 방 알림을 켰습니다." : "이 방 알림을 껐습니다.");
    onRoomUpdatedRef.current?.();
  };

  const annotatedMessages = useMemo(() => {
    const withUnread = messages.map((m) => ({
      ...m,
      unread_count:
        m.unread_count !== undefined
          ? m.unread_count
          : computeMessageUnreadCount(m, participants),
    }));
    return annotateTimelineMessages(withUnread);
  }, [messages, participants]);

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.trim().toLowerCase();
    return annotatedMessages.filter(
      (m) =>
        m.message_type !== "SYSTEM" &&
        parseSafetyDocMessage(m.content).summaryText.toLowerCase().includes(q),
    );
  }, [annotatedMessages, searchQuery]);

  const roomTitle =
    room.custom_name ||
    room.name ||
    (room.is_group
      ? `그룹 대화 (${participants.length || room.participants?.length || 0}명)`
      : room.other_participant?.full_name || "1:1 대화방");

  const participantCompanySummary = useMemo(() => {
    if (!room.is_group && room.other_participant?.company_name) {
      return room.other_participant.company_name;
    }
    const companies = Array.from(
      new Set(
        participants
          .map((p) => p.company_name)
          .filter((c): c is string => Boolean(c && c.trim())),
      ),
    );
    if (companies.length === 0) return room.project_id ? "현장 관리자 대화방" : "전사 통합 대화방";
    if (companies.length === 1) return companies[0];
    return `${companies[0]} 외 ${companies.length - 1}개 업체`;
  }, [room.is_group, room.other_participant, room.project_id, participants]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex flex-col h-full min-h-0 w-full bg-background overflow-hidden relative overscroll-contain"
    >
      {/* 드래그 앤 드롭 오버레이 */}
      {isDragOver && (
        <div className="absolute inset-2 rounded-2xl border-2 border-dashed border-primary bg-primary/10 backdrop-blur-xs z-40 flex flex-col items-center justify-center pointer-events-none">
          <UploadCloud className="h-10 w-10 text-primary mb-2 animate-bounce" />
          <p className="text-sm font-bold text-primary">여기에 사진이나 파일을 놓아 전송하세요</p>
          <p className="text-xs text-muted-foreground mt-0.5">최대 50MB · 이미지 자동 압축 지원</p>
        </div>
      )}

      {/* 대화방 상단 헤더 */}
      <header className="px-3 pt-[max(0.625rem,var(--sat))] pb-2.5 border-b bg-card flex items-center justify-between shrink-0 shadow-2xs z-10">
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
                  {participants.length || room.participants?.length || 0}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
              <ShieldCheck className="h-2.5 w-2.5 text-primary" />
              <span>{participantCompanySummary}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setIsSearchOpen((v) => !v);
              if (isSearchOpen) setSearchQuery("");
            }}
            title="대화 내용 검색"
            aria-label="대화 내용 검색"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => void handleToggleNotifications()}
            disabled={muteSaving}
            title={notificationsEnabled ? "이 방 알림 끄기" : "이 방 알림 켜기"}
            aria-label={notificationsEnabled ? "이 방 알림 끄기" : "이 방 알림 켜기"}
          >
            {notificationsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setIsDrawerOpen((v) => !v)}
            title="대화방 서랍 및 참여자 정보"
            aria-label="대화방 서랍 열기"
          >
            <PanelRightOpen className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 대화방 내 메시지 검색 바 */}
      {isSearchOpen && (
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 shrink-0 animate-in slide-in-from-top-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="이 대화방에서 메시지 검색..."
            className="h-7 text-xs bg-background flex-1"
          />
          {searchQuery.trim() && (
            <span className="text-[11px] text-muted-foreground shrink-0">
              {searchMatches.length}건
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground"
            onClick={() => {
              setIsSearchOpen(false);
              setSearchQuery("");
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* 상단 고정 공지 배너 (네이버웍스 / 카카오톡 스타일) */}
      {pinnedPreview && (
        <div className="px-3 py-2 border-b bg-amber-500/10 border-amber-500/20 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void scrollToMessage(pinnedPreview.id)}
            className="flex items-center gap-2 min-w-0 text-left flex-1 cursor-pointer"
          >
            <span className="h-6 w-6 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Megaphone className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                <span>필독 공지</span>
                <span className="font-normal opacity-80">· {pinnedPreview.sender_name}</span>
              </div>
              <p className="text-xs text-foreground truncate font-medium">
                {pinnedPreview.content}
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void setChatPinnedMessage(room.id, null).then(() => setPinnedMessageId(null))}
            className="p-1 text-muted-foreground hover:text-foreground rounded shrink-0"
            title="공지 내리기"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 메시지 리스트 뷰포트 */}
      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-2"
      >
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            메시지를 불러오는 중...
          </div>
        ) : annotatedMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
            <Users className="h-10 w-10 stroke-1 mb-2 text-muted-foreground/60" />
            <p className="text-xs font-medium">대화가 시작되었습니다.</p>
            <p className="text-[11px] mt-1 text-muted-foreground/80">
              첫 메시지나 안전문서 카드, 현장 사진을 보내 안전 관리 업무를 공유해 보세요.
            </p>
          </div>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-muted-foreground"
                  onClick={() => void loadOlder()}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? "이전 대화를 불러오는 중..." : "이전 대화 보기"}
                </Button>
              </div>
            )}
            {annotatedMessages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isMe={msg.sender_id === user?.id}
                currentUserId={user?.id}
                showDateDivider={msg.showDateDivider}
                dateLabel={msg.dateLabel}
                isFirstInGroup={msg.isFirstInGroup}
                isLastInGroup={msg.isLastInGroup}
                isPinned={pinnedMessageId === msg.id}
                highlightQuery={searchQuery}
                onReply={(m) => setReplyTarget(m)}
                onScrollToMessage={(id) => void scrollToMessage(id)}
                onToggleReaction={(id, emoji) => void handleToggleReaction(id, emoji)}
                onPinMessage={(m) => void handlePinMessage(m)}
                onDeleteMessage={(m) => void handleDeleteMessage(m)}
              />
            ))}
          </>
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
                {parseSafetyDocMessage(replyTarget.content).summaryText}
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

      {/* 메시지 및 파일/안전문서 입력창 */}
      <div
        className="p-2.5 pb-[max(0.625rem,var(--sab))] border-t bg-card shrink-0"
        style={keyboardInset > 0 ? { paddingBottom: keyboardInset + 8 } : undefined}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.zip"
          className="hidden"
        />

        <div className="flex items-end gap-1 bg-background border rounded-xl p-1.5 shadow-2xs focus-within:ring-1 focus-within:ring-primary">
          {/* 사진 및 파일 첨부 버튼 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 mb-0.5 rounded-lg"
            title="사진 또는 파일 첨부 (드래그 앤 드롭 / Ctrl+V 지원)"
            aria-label="첨부파일"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          {/* SafeNex 안전문서 카드 공유 버튼 */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setIsShareDocOpen(true)}
            disabled={sending}
            className="h-8 w-8 text-muted-foreground hover:text-primary shrink-0 mb-0.5 rounded-lg"
            title="작업허가서·위험성평가·작업계획서 카드 공유"
            aria-label="안전문서 공유"
          >
            <FileCheck2 className="h-4 w-4" />
          </Button>

          <Textarea
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              selectedFile
                ? "설명 메시지를 입력하세요 (선택)..."
                : "메시지 입력 (Enter: 전송, Shift+Enter: 줄바꿈, Ctrl+V: 캡처 첨부)"
            }
            className="min-h-[38px] max-h-24 resize-none border-0 shadow-none focus-visible:ring-0 text-xs p-1.5 leading-relaxed"
            rows={1}
          />

          <Button
            type="button"
            size="icon"
            onClick={() => void handleSend()}
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

      {/* 우측 슬라이드 서랍 (참여자, 사진·파일 모아보기, 방 설정) */}
      <MessengerRoomDrawer
        room={{ ...room, participants }}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onRoomUpdated={() => onRoomUpdatedRef.current?.()}
        onRoomLeft={() => {
          onRoomUpdatedRef.current?.();
          onBack?.();
        }}
      />

      {/* SafeNex 안전문서 카드 공유 모달 */}
      <ShareSafetyDocModal
        isOpen={isShareDocOpen}
        onClose={() => setIsShareDocOpen(false)}
        projectId={room.project_id}
        onSelectDoc={(doc) => void handleShareSafetyDoc(doc)}
      />
    </div>
  );
}
