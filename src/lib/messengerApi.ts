import { supabase } from "@/integrations/supabase/client";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  olderChatMessagesFilter,
  type SafetyDocCardPayload,
} from "@/lib/chatMessages";
import {
  compressUploadFile,
  isCompressibleImage,
  sanitizeStorageFileName,
} from "@/lib/compressUploadFile";

export type ChatMessageType = "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "SYSTEM";
export type ChatStorageProvider = "GCS" | "SUPABASE";

export interface ChatRoom {
  id: string;
  project_id: string | null;
  name: string | null;
  custom_name?: string | null;
  is_group: boolean;
  created_by: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  pinned_message_id: string | null;
  created_at: string;
  updated_at: string;
  /** 이 방에서 내 알림이 켜져 있는지. 끄면 푸시만 멈추고 목록은 그대로다. */
  notifications_enabled?: boolean;
  // Joins & derived
  unread_count?: number;
  participants?: ChatParticipant[];
  other_participant?: ChatParticipant; // For 1:1 chat display
}

export interface ChatParticipant {
  id: string;
  room_id: string;
  user_id: string;
  room_name_override: string | null;
  is_notification_enabled: boolean;
  last_read_at: string;
  last_read_message_id: string | null;
  joined_at: string;
  left_at: string | null;
  // Profile info
  full_name?: string | null;
  company_name?: string | null;
  role?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
}

export interface ChatAttachment {
  id: string;
  message_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  storage_provider: ChatStorageProvider;
  gcs_bucket: string;
  gcs_blob_name: string;
  public_url: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface ChatReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ChatRoomMessage {
  id: string;
  room_id: string;
  sender_id: string;
  parent_id: string | null;
  message_type: ChatMessageType;
  content: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  // Joins
  sender_name?: string | null;
  sender_company?: string | null;
  sender_role?: string | null;
  sender_avatar?: string | null;
  attachments?: ChatAttachment[];
  reactions?: ChatReaction[];
  parent_message?: {
    id: string;
    sender_name: string | null;
    content: string;
  } | null;
  read_count?: number;
  unread_count?: number;
}

export interface ChatContact {
  user_id: string;
  full_name: string | null;
  company_name: string | null;
  role: string | null;
  phone: string | null; // NULL if another company
  avatar_url: string | null;
  is_same_company: boolean;
  project_id: string | null;
  /** 마스터 명단에서만. 그 사람이 프로젝트 관리자인 현장 이름. */
  project_label?: string | null;
}

export interface ChatMessageReader {
  user_id: string;
  name: string | null;
  company: string | null;
  role: string | null;
  phone?: string | null;
  read_at: string;
}

export interface ChatMessageUnreader {
  user_id: string;
  name: string | null;
  company: string | null;
  role: string | null;
}

export interface ChatReadReceiptsResult {
  message_id: string;
  read_count: number;
  unread_count: number;
  readers: ChatMessageReader[];
  unreaders: ChatMessageUnreader[];
  error?: string;
}

const FAVORITE_ROOMS_KEY = "safenex_messenger_favorite_rooms_v1";

export function getFavoriteRoomIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITE_ROOMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toggleFavoriteRoomId(roomId: string): string[] {
  const current = new Set(getFavoriteRoomIds());
  if (current.has(roomId)) {
    current.delete(roomId);
  } else {
    current.add(roomId);
  }
  const next = Array.from(current);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(FAVORITE_ROOMS_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }
  return next;
}

/**
 * 내가 참여 중인 대화방 목록 조회 (참여자 정보 및 미확인 카운트 포함)
 */
export async function fetchMyChatRooms(): Promise<ChatRoom[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // 1. 내가 참여 중인 활성 방 ID 및 내 last_read_at 조회
  const { data: myParticipations, error: partErr } = await supabase
    .from("chat_participants" as any)
    .select("room_id, last_read_at, room_name_override, is_notification_enabled")
    .eq("user_id", user.id)
    .is("left_at", null);

  if (partErr || !myParticipations || myParticipations.length === 0) {
    return [];
  }

  const roomIds = (myParticipations as any[]).map((p) => p.room_id);

  // 2. 대화방 기본 정보 및 참여자 전체 정보 병렬 조회
  const [{ data: rooms, error: roomErr }, { data: allParticipants }] = await Promise.all([
    supabase
      .from("chat_rooms" as any)
      .select("*")
      .in("id", roomIds)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("chat_participants" as any)
      .select("id, room_id, user_id, joined_at, last_read_at")
      .in("room_id", roomIds)
      .is("left_at", null),
  ]);

  if (roomErr || !rooms) return [];

  const participantUserIds = Array.from(
    new Set((allParticipants || []).map((p: any) => p.user_id).filter(Boolean)),
  );

  const { data: profiles } =
    participantUserIds.length > 0
      ? await supabase
          .from("profiles")
          .select("user_id, display_name, company, position")
          .in("user_id", participantUserIds)
      : { data: [] as any[] };

  const profileMap = new Map((profiles || []).map((pr) => [pr.user_id, pr]));
  const myPartMap = new Map((myParticipations as any[]).map((p) => [p.room_id, p]));

  const { data: unreadRows, error: unreadErr } = await (supabase.rpc as any)("count_my_chat_unreads", {
    p_room_ids: roomIds,
  });
  const unreadMap = new Map<string, number>();
  if (!unreadErr && Array.isArray(unreadRows)) {
    for (const row of unreadRows as { room_id: string; unread_count: number }[]) {
      unreadMap.set(row.room_id, Number(row.unread_count) || 0);
    }
  }

  // 3. 각 방의 미확인 메시지 수. RPC가 있으면 한 번만 묻고, 아직 함수가 없으면 방마다 센다.
  const enrichedRooms: ChatRoom[] = await Promise.all(
    (rooms as any[]).map(async (room) => {
      const myPart = myPartMap.get(room.id);
      let unread_count = unreadMap.get(room.id) || 0;

      if (unreadErr && myPart?.last_read_at) {
        const { count } = await supabase
          .from("chat_room_messages" as any)
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id)
          .neq("sender_id", user.id)
          .gt("created_at", myPart.last_read_at)
          .eq("is_deleted", false);

        unread_count = count || 0;
      }

      const roomParticipants: ChatParticipant[] = (allParticipants || [])
        .filter((p: any) => p.room_id === room.id)
        .map((p: any) => {
          const pr = profileMap.get(p.user_id);
          const mine = p.user_id === user.id;
          return {
            id: p.id,
            room_id: p.room_id,
            user_id: p.user_id,
            room_name_override: mine ? myPart?.room_name_override ?? null : null,
            is_notification_enabled: mine ? myPart?.is_notification_enabled !== false : true,
            last_read_at: p.last_read_at,
            last_read_message_id: null,
            joined_at: p.joined_at,
            left_at: null,
            full_name: pr?.display_name || "사용자",
            company_name: pr?.company || null,
            role: pr?.position || null,
          };
        });

      const otherParticipant = roomParticipants.find((p) => p.user_id !== user.id);

      return {
        ...room,
        custom_name: myPart?.room_name_override || null,
        unread_count,
        notifications_enabled: myPart?.is_notification_enabled !== false,
        participants: roomParticipants,
        other_participant: otherParticipant,
      };
    }),
  );

  return enrichedRooms;
}

export interface ChatMessageCursor {
  createdAt: string;
  id: string;
}

export interface FetchRoomMessagesResult {
  messages: ChatRoomMessage[];
  hasMore: boolean;
}

async function hydrateChatMessages(rows: any[]): Promise<ChatRoomMessage[]> {
  if (rows.length === 0) return [];

  const messageIds = rows.map((m) => m.id);
  const missingParentIds = Array.from(
    new Set(
      rows
        .map((m) => m.parent_id as string | null)
        .filter((id): id is string => Boolean(id) && !messageIds.includes(id)),
    ),
  );

  let parentRows: any[] = [];
  if (missingParentIds.length > 0) {
    const { data } = await supabase
      .from("chat_room_messages" as any)
      .select("id, sender_id, content")
      .in("id", missingParentIds);
    parentRows = data || [];
  }

  const senderIds = Array.from(
    new Set(
      [...rows.map((m) => m.sender_id), ...parentRows.map((m) => m.sender_id)].filter(Boolean),
    ),
  );

  const [{ data: profiles }, { data: attachments }, { data: reactions }] = await Promise.all([
    senderIds.length > 0
      ? supabase
          .from("profiles")
          .select("user_id, display_name, company, position")
          .in("user_id", senderIds)
      : Promise.resolve({ data: [] as any[] }),
    messageIds.length > 0
      ? supabase.from("chat_attachments" as any).select("*").in("message_id", messageIds)
      : Promise.resolve({ data: [] as any[] }),
    messageIds.length > 0
      ? supabase.from("chat_reactions" as any).select("*").in("message_id", messageIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const profileMap = new Map((profiles || []).map((pr) => [pr.user_id, pr]));
  const attachmentMap = new Map<string, ChatAttachment[]>();
  (attachments || []).forEach((att: any) => {
    const list = attachmentMap.get(att.message_id) || [];
    list.push(att);
    attachmentMap.set(att.message_id, list);
  });

  const reactionMap = new Map<string, ChatReaction[]>();
  (reactions || []).forEach((rx: any) => {
    const list = reactionMap.get(rx.message_id) || [];
    list.push(rx);
    reactionMap.set(rx.message_id, list);
  });

  const msgMap = new Map<string, any>();
  rows.forEach((m) => msgMap.set(m.id, m));
  parentRows.forEach((m) => {
    if (!msgMap.has(m.id)) msgMap.set(m.id, m);
  });

  return rows.map((m) => {
    const pr = profileMap.get(m.sender_id);
    const parent = m.parent_id ? msgMap.get(m.parent_id) : null;
    const parentPr = parent ? profileMap.get(parent.sender_id) : null;

    return {
      ...m,
      sender_name: pr?.display_name || "사용자",
      sender_company: pr?.company || null,
      sender_role: pr?.position || null,
      attachments: attachmentMap.get(m.id) || [],
      reactions: reactionMap.get(m.id) || [],
      parent_message: parent
        ? {
            id: parent.id,
            sender_name: parentPr?.display_name || "사용자",
            content: parent.content,
          }
        : null,
    };
  });
}

/**
 * 대화방 메시지. 최신 페이지부터 읽고, before 가 있으면 그 커서보다 이전만 가져온다.
 * 한 번에 가져오는 양은 첫 화면용이며, 더 오래된 대화는 이어서 불러온다.
 */
export async function fetchRoomMessages(
  roomId: string,
  options?: { before?: ChatMessageCursor | null; limit?: number },
): Promise<FetchRoomMessagesResult> {
  const limit = options?.limit ?? CHAT_MESSAGE_PAGE_SIZE;
  let query = supabase
    .from("chat_room_messages" as any)
    .select("*")
    .eq("room_id", roomId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (options?.before) {
    query = query.or(olderChatMessagesFilter(options.before.createdAt, options.before.id));
  }

  const { data: messages, error } = await query;
  if (error || !messages) return { messages: [], hasMore: false };
  if (messages.length === 0) return { messages: [], hasMore: false };

  const chronological = [...(messages as any[])].reverse();
  return {
    messages: await hydrateChatMessages(chronological),
    hasMore: messages.length === limit,
  };
}

/**
 * 대화방 파일 업로드 (스마트폰 사진 자동 압축 및 안전한 Storage 저장)
 */
export async function uploadChatFile(
  file: File,
  roomId: string,
): Promise<{
  fileName: string;
  fileSize: number;
  mimeType: string;
  publicUrl: string;
  isImage: boolean;
} | null> {
  const isImage = isCompressibleImage(file);
  let fileToUpload = file;

  if (isImage) {
    try {
      const compressed = await compressUploadFile(file);
      fileToUpload = compressed.file;
    } catch {
      fileToUpload = file;
    }
  }

  const safeName = sanitizeStorageFileName(file.name);
  const objectPath = `chat/${roomId}/${Date.now()}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(objectPath, fileToUpload, {
      cacheControl: "3600",
      upsert: false,
    });

  if (upErr) {
    console.error("uploadChatFile error:", upErr);
    return null;
  }

  const { data: pubData } = supabase.storage
    .from("attachments")
    .getPublicUrl(objectPath);

  return {
    fileName: file.name,
    fileSize: fileToUpload.size,
    mimeType: file.type || (isImage ? "image/jpeg" : "application/octet-stream"),
    publicUrl: pubData.publicUrl,
    isImage,
  };
}

/**
 * 새 메시지 전송 (파일/사진 첨부 지원)
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  parentId?: string | null,
  attachment?: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    publicUrl: string;
    isImage: boolean;
  } | null,
): Promise<ChatRoomMessage | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let messageType: ChatMessageType = "TEXT";
  let finalContent = content.trim();

  if (attachment) {
    messageType = attachment.isImage ? "IMAGE" : "FILE";
    if (!finalContent) {
      finalContent = attachment.isImage ? "사진을 보냈습니다." : `${attachment.fileName} 파일을 보냈습니다.`;
    }
  }

  const { data: newMsg, error } = await supabase
    .from("chat_room_messages" as any)
    .insert({
      room_id: roomId,
      sender_id: user.id,
      content: finalContent,
      parent_id: parentId || null,
      message_type: messageType,
    })
    .select("*")
    .single();

  if (error || !newMsg) {
    console.error("sendChatMessage error:", error);
    return null;
  }

  // 첨부파일 레코드 등록
  let savedAttachments: ChatAttachment[] = [];
  if (attachment) {
    const { data: attData, error: attErr } = await supabase
      .from("chat_attachments" as any)
      .insert({
        message_id: (newMsg as any).id,
        file_name: attachment.fileName,
        file_size: attachment.fileSize,
        mime_type: attachment.mimeType,
        storage_provider: "SUPABASE",
        gcs_bucket: "attachments",
        gcs_blob_name: attachment.publicUrl,
        public_url: attachment.publicUrl,
        thumbnail_url: attachment.isImage ? attachment.publicUrl : null,
      })
      .select("*")
      .single();

    if (!attErr && attData) {
      savedAttachments = [attData as ChatAttachment];
    }
  }

  // last_message_* 는 메시지 INSERT 트리거가 갱신한다.
  await markChatRoomRead(roomId, (newMsg as any).id);

  return {
    ...(newMsg as any),
    attachments: savedAttachments,
    reactions: [],
  } as ChatRoomMessage;
}

/**
 * 새 대화방 개설 (원자적 RPC 함수 호출로 42501 오류 원천 차단)
 */
export async function createChatRoom(params: {
  name?: string | null;
  isGroup: boolean;
  projectId?: string | null;
  inviteUserIds: string[];
}): Promise<string | null> {
  const { data, error } = await (supabase.rpc as any)("create_chat_room", {
    p_name: params.name || null,
    p_is_group: params.isGroup,
    p_project_id: params.projectId || null,
    p_invite_user_ids: params.inviteUserIds,
  });

  if (error) {
    console.error("createChatRoom RPC error:", error);
    return null;
  }

  return data as string;
}

/**
 * 대화상대 검색 (개인정보 보호 및 프로젝트 격리 적용)
 */
export async function fetchChatContacts(
  projectId?: string | null,
  searchQuery?: string | null,
): Promise<ChatContact[]> {
  const { data, error } = await (supabase.rpc as any)("get_chat_contacts", {
    p_project_id: projectId || null,
    p_search_query: searchQuery?.trim() || null,
  });

  if (error) {
    console.error("fetchChatContacts error:", error);
    return [];
  }
  return (data as ChatContact[]) || [];
}

/**
 * 특정 메시지의 라인웍스 스타일 읽은 사람 / 안 읽은 사람 명단 조회
 */
export async function fetchChatMessageReadReceipts(
  messageId: string,
): Promise<ChatReadReceiptsResult | null> {
  const { data, error } = await (supabase.rpc as any)("get_chat_message_read_receipts", {
    p_message_id: messageId,
  });

  if (error) {
    console.error("fetchChatMessageReadReceipts error:", error);
    return null;
  }
  return data as ChatReadReceiptsResult;
}

/**
 * 미확인 참여자에게 재알림 푸시 발송 (라인웍스/네이버웍스 스타일 콕 찌르기)
 */
export async function remindUnreadChatParticipants(
  messageId: string,
): Promise<number | null> {
  const { data, error } = await (supabase.rpc as any)("remind_unread_chat_participants", {
    p_message_id: messageId,
  });

  if (error) {
    console.error("remindUnreadChatParticipants error:", error);
    return null;
  }
  return typeof data === "number" ? data : 0;
}

/**
 * 이 방 알림만 켜거나 끈다. 참여자 행은 본인 것만 바뀐다.
 */
export async function setChatNotificationEnabled(
  roomId: string,
  enabled: boolean,
): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("set_chat_notification_enabled", {
    p_room_id: roomId,
    p_enabled: enabled,
  });

  if (error) {
    console.error("setChatNotificationEnabled error:", error);
    return false;
  }
  return data === true;
}

/**
 * 대화방 단일 읽음 처리 (단 1번의 RPC 호출로 실시간 뱃지 초기화)
 */
export async function markChatRoomRead(
  roomId: string,
  lastMessageId?: string | null,
): Promise<void> {
  const { error } = await (supabase.rpc as any)("mark_chat_room_read", {
    p_room_id: roomId,
    p_last_message_id: lastMessageId || null,
  });

  if (error) {
    console.error("markChatRoomRead error:", error);
  }
}

/**
 * 전체 안 읽은 메시지 수 조회 (헤더 및 모바일 하단 탭 뱃지용)
 */
export async function fetchChatUnreadTotal(): Promise<number> {
  const { data, error } = await (supabase.rpc as any)("get_chat_unread_total");

  if (error) {
    console.error("fetchChatUnreadTotal error:", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}

/**
 * 이모지 리액션 토글 (추가 또는 해제)
 */
export async function toggleChatReaction(
  messageId: string,
  emoji: string,
): Promise<{ added: boolean; reaction?: ChatReaction } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from("chat_reactions" as any)
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .eq("emoji", emoji)
    .maybeSingle();

  if (existing && (existing as any).id) {
    const { error: delErr } = await supabase
      .from("chat_reactions" as any)
      .delete()
      .eq("id", (existing as any).id);
    if (delErr) {
      console.error("toggleChatReaction delete error:", delErr);
      return null;
    }
    return { added: false };
  }

  const { data: inserted, error: insErr } = await supabase
    .from("chat_reactions" as any)
    .insert({
      message_id: messageId,
      user_id: user.id,
      emoji,
    })
    .select("*")
    .single();

  if (insErr || !inserted) {
    console.error("toggleChatReaction insert error:", insErr);
    return null;
  }

  return { added: true, reaction: inserted as ChatReaction };
}

/**
 * 대화방 상단 공지 고정 / 해제
 */
export async function setChatPinnedMessage(
  roomId: string,
  messageId: string | null,
): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("set_chat_pinned_message", {
    p_room_id: roomId,
    p_message_id: messageId,
  });

  if (!error) return data === true;

  // Fallback: direct update if RPC is not deployed yet
  const { error: upErr } = await supabase
    .from("chat_rooms" as any)
    .update({ pinned_message_id: messageId, updated_at: new Date().toISOString() })
    .eq("id", roomId);

  return !upErr;
}

/**
 * 고정된 공지 메시지 단건 조회
 */
export async function fetchPinnedMessagePreview(
  messageId: string,
): Promise<{ id: string; content: string; sender_name: string } | null> {
  const { data: msg } = await supabase
    .from("chat_room_messages" as any)
    .select("id, sender_id, content, is_deleted")
    .eq("id", messageId)
    .maybeSingle();

  if (!msg || (msg as any).is_deleted) return null;

  const { data: pr } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", (msg as any).sender_id)
    .maybeSingle();

  return {
    id: (msg as any).id,
    content: (msg as any).content || "",
    sender_name: pr?.display_name || "관리자",
  };
}

/**
 * 본인 메시지 삭제 (회수)
 */
export async function deleteMyChatMessage(messageId: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("delete_my_chat_message", {
    p_message_id: messageId,
  });

  if (!error) return data === true;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error: upErr } = await supabase
    .from("chat_room_messages" as any)
    .update({
      is_deleted: true,
      content: "삭제된 메시지입니다.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .eq("sender_id", user.id);

  return !upErr;
}

/**
 * 대화방 추가 인원 초대
 */
export async function inviteChatParticipants(
  roomId: string,
  userIds: string[],
): Promise<number> {
  const { data, error } = await (supabase.rpc as any)("invite_chat_participants", {
    p_room_id: roomId,
    p_user_ids: userIds,
  });

  if (!error && typeof data === "number") return data;
  console.error("inviteChatParticipants error:", error);
  return 0;
}

/**
 * 대화방 나가기
 */
export async function touchChatRoomPresence(roomId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("touch_chat_room_presence", {
    p_room_id: roomId,
  });
  if (error) console.warn("touchChatRoomPresence error:", error.message);
}

export async function clearChatRoomPresence(roomId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("clear_chat_room_presence", {
    p_room_id: roomId,
  });
  if (error) console.warn("clearChatRoomPresence error:", error.message);
}

/** 그룹방을 만든 사람만. 참여자 전체 목록에서 방과 메시지가 사라진다. */
export async function deleteChatRoom(roomId: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("delete_chat_room", {
    p_room_id: roomId,
  });
  if (error) {
    console.error("deleteChatRoom error:", error);
    return false;
  }
  return data === true;
}

export async function leaveChatRoom(roomId: string): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("leave_chat_room", {
    p_room_id: roomId,
  });

  if (!error) return data === true;
  console.error("leaveChatRoom error:", error);
  return false;
}

/**
 * 대화방 이름 변경
 */
export async function setChatRoomName(
  roomId: string,
  name: string,
  forEveryone = false,
): Promise<boolean> {
  const { data, error } = await (supabase.rpc as any)("set_chat_room_name", {
    p_room_id: roomId,
    p_name: name,
    p_for_everyone: forEveryone,
  });

  if (!error) return data === true;
  console.error("setChatRoomName error:", error);
  return false;
}

/**
 * 대화방 내 모든 사진 및 첨부파일 모아보기 조회 (우측 서랍용)
 */
export async function fetchRoomAttachments(roomId: string): Promise<ChatAttachment[]> {
  const { data: msgRows } = await supabase
    .from("chat_room_messages" as any)
    .select("id")
    .eq("room_id", roomId)
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!msgRows || msgRows.length === 0) return [];
  const msgIds = (msgRows as any[]).map((m) => m.id);

  const { data: attachments } = await supabase
    .from("chat_attachments" as any)
    .select("*")
    .in("message_id", msgIds)
    .order("created_at", { ascending: false });

  return (attachments as ChatAttachment[]) || [];
}

/**
 * 대화방에서 즉시 공유 가능한 SafeNex 안전문서 목록 조회
 */
export async function fetchShareableSafetyDocs(
  projectId?: string | null,
): Promise<SafetyDocCardPayload[]> {
  let permitQuery = supabase
    .from("work_permits")
    .select("id, work_name, permit_date, status, location_detail")
    .order("created_at", { ascending: false })
    .limit(8);
  if (projectId) permitQuery = permitQuery.eq("project_id", projectId);

  let runQuery = supabase
    .from("assessment_runs")
    .select("id, period_label, status, start_date, end_date")
    .order("created_at", { ascending: false })
    .limit(8);
  if (projectId) runQuery = runQuery.eq("project_id", projectId);

  let planQuery = supabase
    .from("work_plans")
    .select("id, title, status, work_location")
    .order("created_at", { ascending: false })
    .limit(8);
  if (projectId) planQuery = planQuery.eq("project_id", projectId);

  const [permitsRes, runsRes, plansRes] = await Promise.all([
    permitQuery,
    runQuery,
    planQuery,
  ]);

  const docs: SafetyDocCardPayload[] = [];

  for (const p of (permitsRes.data || []) as any[]) {
    docs.push({
      kind: "work_permit",
      id: p.id,
      title: p.work_name || "작업허가서",
      subtitle: [p.permit_date, p.location_detail].filter(Boolean).join(" · ") || null,
      statusLabel: p.status || null,
      url: `/app/admin/work-permits/${p.id}`,
    });
  }

  for (const r of (runsRes.data || []) as any[]) {
    docs.push({
      kind: "assessment_run",
      id: r.id,
      title: r.period_label || "위험성평가",
      subtitle: [r.start_date, r.end_date].filter(Boolean).join(" ~ ") || null,
      statusLabel: r.status || null,
      url: `/app/admin/assessment-run/${r.id}`,
    });
  }

  for (const pl of (plansRes.data || []) as any[]) {
    docs.push({
      kind: "work_plan",
      id: pl.id,
      title: pl.title || "작업계획서",
      subtitle: pl.work_location || null,
      statusLabel: pl.status || null,
      url: `/app/admin/work-plan/${pl.id}`,
    });
  }

  return docs;
}
