import { supabase } from "@/integrations/supabase/client";

/**
 * 알림 단건 읽음 처리 (알림 고유 ID)
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  if (!notificationId) return;
  try {
    await supabase.from("notifications").update({ is_read: true }).eq("id", notificationId);
  } catch (e) {
    console.warn("Failed to mark notification as read", e);
  }
}

/**
 * 결재 문서나 특정 엔티티를 열람/확인했을 때 해당 문서와 관련된 미확인 알림 전체 읽음 처리
 */
export async function markRelatedNotificationsAsRead(
  userId: string | undefined | null,
  relatedId: string | undefined | null,
): Promise<void> {
  if (!userId || !relatedId) return;
  try {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("related_id", String(relatedId))
      .eq("is_read", false);
  } catch (e) {
    console.warn("Failed to mark related notifications as read", e);
  }
}

/**
 * 결재 목록 진입 또는 결재 승인/반려 시 결재 요청(approval_request) 미확인 알림 일괄 읽음 처리
 */
export async function markApprovalNotificationsAsRead(
  userId: string | undefined | null,
): Promise<void> {
  if (!userId) return;
  try {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("type", "approval_request")
      .eq("is_read", false);
  } catch (e) {
    console.warn("Failed to mark approval notifications as read", e);
  }
}

export type ChatReadMark = { roomId: string; lastReadAt: string | null };

type UnreadChatRow = {
  id: string;
  type?: string | null;
  related_id?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
};

/**
 * Messenger rows already covered by opening the room.
 * A message that arrived after last_read_at stays unread.
 */
export function chatNotificationIdsCoveredByRead(
  rows: readonly UnreadChatRow[],
  reads: readonly ChatReadMark[],
): string[] {
  const readAtByRoom = new Map<string, number>();
  for (const read of reads) {
    if (!read.roomId || !read.lastReadAt) continue;
    const at = new Date(read.lastReadAt).getTime();
    if (Number.isNaN(at)) continue;
    readAtByRoom.set(read.roomId, at);
  }
  const ids: string[] = [];
  for (const row of rows) {
    if (row.is_read) continue;
    if ((row.type || "") !== "chat_message") continue;
    if (!row.id || !row.related_id || !row.created_at) continue;
    const readAt = readAtByRoom.get(row.related_id);
    if (readAt == null) continue;
    const created = new Date(row.created_at).getTime();
    if (Number.isNaN(created) || created > readAt) continue;
    ids.push(row.id);
  }
  return ids;
}

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Room open already moved last_read_at. Clear only this user's messenger rows for that room. */
export async function markChatRoomNotificationsRead(roomId: string): Promise<boolean> {
  if (!roomId) return false;
  try {
    const userId = await currentUserId();
    if (!userId) return false;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("type", "chat_message")
      .eq("related_id", roomId)
      .eq("is_read", false);
    if (error) {
      console.warn("Failed to mark chat notifications as read", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Failed to mark chat notifications as read", e);
    return false;
  }
}

/** The open document, and only that document. */
export async function markOpenDocumentNotifications(relatedId: string | null | undefined): Promise<boolean> {
  if (!relatedId) return false;
  try {
    const userId = await currentUserId();
    if (!userId) return false;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("related_id", relatedId)
      .eq("is_read", false);
    if (error) {
      console.warn("Failed to mark document notifications as read", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Failed to mark document notifications as read", e);
    return false;
  }
}

/** Drop messenger rows the user already read in the room. Leaves newer messages unread. */
export async function applyChatReadMarks<T extends UnreadChatRow>(
  userId: string,
  rows: T[],
): Promise<T[]> {
  const pending = rows.some((row) => !row.is_read && row.type === "chat_message" && row.related_id);
  if (!userId || !pending) return rows;
  try {
    const roomIds = [...new Set(
      rows
        .filter((row) => !row.is_read && row.type === "chat_message" && row.related_id)
        .map((row) => String(row.related_id)),
    )];
    const { data, error } = await (supabase as any)
      .from("chat_participants")
      .select("room_id, last_read_at")
      .eq("user_id", userId)
      .in("room_id", roomIds)
      .is("left_at", null);
    if (error || !data) return rows;
    const ids = chatNotificationIdsCoveredByRead(
      rows,
      (data as unknown as Array<{ room_id: string; last_read_at: string | null }>).map((part) => ({
        roomId: part.room_id,
        lastReadAt: part.last_read_at,
      })),
    );
    if (!ids.length) return rows;
    const { error: updateError } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .in("id", ids);
    if (updateError) return rows;
    const covered = new Set(ids);
    return rows.map((row) => (covered.has(row.id) ? { ...row, is_read: true } : row));
  } catch (e) {
    console.warn("Failed to reconcile chat notifications", e);
    return rows;
  }
}

/** Announcements whose full text is on the current page. */
export async function markAnnouncementNotificationsRead(announcementIds: readonly string[]): Promise<boolean> {
  const ids = [...new Set(announcementIds.map((id) => id.trim()).filter(Boolean))];
  if (!ids.length) return false;
  try {
    const userId = await currentUserId();
    if (!userId) return false;
    const { error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("type", "announcement")
      .in("related_id", ids)
      .eq("is_read", false);
    if (error) {
      console.warn("Failed to mark announcement notifications as read", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("Failed to mark announcement notifications as read", e);
    return false;
  }
}
