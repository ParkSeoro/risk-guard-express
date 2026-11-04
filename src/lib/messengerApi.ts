import { supabase } from "@/integrations/supabase/client";
import {
  CHAT_MESSAGE_PAGE_SIZE,
  olderChatMessagesFilter,
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

  // 2. 대화방 기본 정보 조회
  const { data: rooms, error: roomErr } = await supabase
    .from("chat_rooms" as any)
    .select("*")
    .in("id", roomIds)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (roomErr || !rooms) return [];

  // 3. 각 방의 참여자 전체 정보 조회 (profiles 매핑)
  const { data: allParticipants } = await supabase
    .from("chat_participants" as any)
    .select("id, room_id, user_id, joined_at, last_read_at")
    .in("room_id", roomIds)
    .is("left_at", null);

  const participantUserIds = Array.from(new Set((allParticipants || []).map((p: any) => p.user_id)));
  
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name, company, position")
    .in("user_id", participantUserIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.user_id, pr]));

  // 4. 각 방의 미확인 메시지 수 집계
  const myPartMap = new Map((myParticipations as any[]).map((p) => [p.room_id, p]));

  const enrichedRooms: ChatRoom[] = await Promise.all(
    (rooms as any[]).map(async (room) => {
      const myPart = myPartMap.get(room.id);
      let unread_count = 0;

      if (myPart?.last_read_at) {
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
        unread_count,
        notifications_enabled: myPart?.is_notification_enabled !== false,
        participants: roomParticipants,
        other_participant: otherParticipant,
      };
    })
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

  const [{ data: profiles }, { data: attachments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id, display_name, company, position")
      .in("user_id", senderIds),
    supabase.from("chat_attachments" as any).select("*").in("message_id", messageIds),
  ]);

  const profileMap = new Map((profiles || []).map((pr) => [pr.user_id, pr]));
  const attachmentMap = new Map<string, ChatAttachment[]>();
  (attachments || []).forEach((att: any) => {
    const list = attachmentMap.get(att.message_id) || [];
    list.push(att);
    attachmentMap.set(att.message_id, list);
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
  // chat_rooms 에는 참여자 UPDATE 정책이 없어 여기서 고치면 조용히 실패한다.
  await markChatRoomRead(roomId, (newMsg as any).id);

  return {
    ...(newMsg as any),
    attachments: savedAttachments,
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
