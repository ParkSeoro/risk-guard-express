import { supabase } from "@/integrations/supabase/client";

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
    .select("user_id, display_name, company, position, phone")
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
          return {
            id: p.id,
            room_id: p.room_id,
            user_id: p.user_id,
            room_name_override: null,
            is_notification_enabled: true,
            last_read_at: p.last_read_at,
            last_read_message_id: null,
            joined_at: p.joined_at,
            left_at: null,
            full_name: pr?.display_name || "사용자",
            company_name: pr?.company || null,
            role: pr?.position || null,
            phone: pr?.phone || null,
          };
        });

      const otherParticipant = roomParticipants.find((p) => p.user_id !== user.id);

      return {
        ...room,
        unread_count,
        participants: roomParticipants,
        other_participant: otherParticipant,
      };
    })
  );

  return enrichedRooms;
}

/**
 * 특정 대화방의 메시지 내역 조회
 */
export async function fetchRoomMessages(roomId: string): Promise<ChatRoomMessage[]> {
  const { data: messages, error } = await supabase
    .from("chat_room_messages" as any)
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (error || !messages) return [];

  const senderIds = Array.from(new Set((messages as any[]).map((m) => m.sender_id)));
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, display_name, company, position")
    .in("user_id", senderIds);

  const profileMap = new Map((profiles || []).map((pr) => [pr.user_id, pr]));

  // 답장 부모 메시지 매핑
  const msgMap = new Map((messages as any[]).map((m) => [m.id, m]));

  return (messages as any[]).map((m) => {
    const pr = profileMap.get(m.sender_id);
    const parent = m.parent_id ? msgMap.get(m.parent_id) : null;
    const parentPr = parent ? profileMap.get(parent.sender_id) : null;

    return {
      ...m,
      sender_name: pr?.display_name || "사용자",
      sender_company: pr?.company || null,
      sender_role: pr?.position || null,
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
 * 새 메시지 전송
 */
export async function sendChatMessage(
  roomId: string,
  content: string,
  parentId?: string | null,
  messageType: ChatMessageType = "TEXT",
): Promise<ChatRoomMessage | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: newMsg, error } = await supabase
    .from("chat_room_messages" as any)
    .insert({
      room_id: roomId,
      sender_id: user.id,
      content: content.trim(),
      parent_id: parentId || null,
      message_type: messageType,
    })
    .select("*")
    .single();

  if (error || !newMsg) {
    console.error("sendChatMessage error:", error);
    return null;
  }

  // 대화방 마지막 메시지 갱신 및 내 읽은 시각 갱신
  await supabase
    .from("chat_rooms" as any)
    .update({
      last_message_text: content.trim().slice(0, 100),
      last_message_at: new Date().toISOString(),
      last_message_sender_id: user.id,
    })
    .eq("id", roomId);

  await markChatRoomRead(roomId, (newMsg as any).id);

  return newMsg as ChatRoomMessage;
}

/**
 * 새 대화방 개설 (1:1 또는 그룹 대화방)
 */
export async function createChatRoom(params: {
  name?: string | null;
  isGroup: boolean;
  projectId?: string | null;
  inviteUserIds: string[];
}): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 1:1 대화방인 경우 기존에 둘 사이에 열린 1:1 방이 있는지 확인
  if (!params.isGroup && params.inviteUserIds.length === 1) {
    const targetUserId = params.inviteUserIds[0];

    const { data: myRooms } = await supabase
      .from("chat_participants" as any)
      .select("room_id")
      .eq("user_id", user.id)
      .is("left_at", null);

    if (myRooms && myRooms.length > 0) {
      const roomIds = (myRooms as any[]).map((r) => r.room_id);
      const { data: commonRooms } = await supabase
        .from("chat_participants" as any)
        .select("room_id")
        .eq("user_id", targetUserId)
        .in("room_id", roomIds)
        .is("left_at", null);

      if (commonRooms && commonRooms.length > 0) {
        // 이미 존재하는 방 중 1:1 방 확인
        const { data: existingGroup } = await supabase
          .from("chat_rooms" as any)
          .select("id, is_group")
          .in("id", (commonRooms as any[]).map((c) => c.room_id))
          .eq("is_group", false)
          .limit(1)
          .maybeSingle();

        if (existingGroup) {
          return (existingGroup as any).id;
        }
      }
    }
  }

  // 1. 방 생성
  const { data: newRoom, error: roomErr } = await supabase
    .from("chat_rooms" as any)
    .insert({
      name: params.name || null,
      is_group: params.isGroup,
      project_id: params.projectId || null,
      created_by: user.id,
      last_message_text: "대화방이 생성되었습니다.",
      last_message_at: new Date().toISOString(),
      last_message_sender_id: user.id,
    })
    .select("id")
    .single();

  if (roomErr || !newRoom) {
    console.error("createChatRoom error:", roomErr);
    return null;
  }

  const roomId = (newRoom as any).id;

  // 2. 참여자 추가 (나 + 초대된 사용자들)
  const allUserIds = Array.from(new Set([user.id, ...params.inviteUserIds]));
  const participantsData = allUserIds.map((uid) => ({
    room_id: roomId,
    user_id: uid,
    last_read_at: new Date().toISOString(),
  }));

  const { error: partErr } = await supabase
    .from("chat_participants" as any)
    .insert(participantsData);

  if (partErr) {
    console.error("addParticipants error:", partErr);
  }

  // 3. 시스템 첫 메시지 기록
  await supabase.from("chat_room_messages" as any).insert({
    room_id: roomId,
    sender_id: user.id,
    message_type: "SYSTEM",
    content: "대화방이 개설되었습니다.",
  });

  return roomId;
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
