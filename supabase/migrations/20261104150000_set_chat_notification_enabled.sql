-- Participants can SELECT chat_participants but cannot UPDATE it.
-- Mute has to go through a definer function that changes only the caller's row.
-- notify_chat_message already skips is_notification_enabled = false.

CREATE OR REPLACE FUNCTION public.set_chat_notification_enabled(
  p_room_id uuid,
  p_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_room_id IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'room and enabled are required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.chat_participants
  SET is_notification_enabled = p_enabled
  WHERE room_id = p_room_id
    AND user_id = v_user_id
    AND left_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.set_chat_notification_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_chat_notification_enabled(uuid, boolean) TO authenticated, service_role;
