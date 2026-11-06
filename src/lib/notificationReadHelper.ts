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
