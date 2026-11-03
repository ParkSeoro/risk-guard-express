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
