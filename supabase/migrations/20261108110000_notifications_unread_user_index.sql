-- The bell and the desktop alert badge count unread rows for one user.
-- This index matches that lookup. It does not change who can read a row.
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id)
  WHERE is_read = false;
