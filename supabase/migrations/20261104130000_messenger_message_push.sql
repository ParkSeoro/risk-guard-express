-- One notification statement per chat message, so the existing push trigger
-- makes a single HTTP call. System lines and muted participants are skipped.
-- Sound stays the normal channel: severity is left null.

CREATE OR REPLACE FUNCTION public.notify_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_body text;
  v_project_id uuid;
  v_link text;
BEGIN
  IF NEW.is_deleted IS TRUE OR upper(COALESCE(NEW.message_type, '')) = 'SYSTEM' THEN
    RETURN NEW;
  END IF;

  IF NOT public.can_use_messenger(NEW.sender_id) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), '관리자')
    INTO v_sender_name
  FROM public.profiles
  WHERE user_id = NEW.sender_id;

  v_sender_name := COALESCE(v_sender_name, '관리자');
  v_body := NULLIF(btrim(left(COALESCE(NEW.content, ''), 80)), '');
  IF v_body IS NULL THEN
    v_body := '새 메시지';
  END IF;

  SELECT project_id INTO v_project_id
  FROM public.chat_rooms
  WHERE id = NEW.room_id;

  v_link := '/app/admin/messenger?room=' || NEW.room_id::text;

  INSERT INTO public.notifications (
    user_id,
    project_id,
    type,
    title,
    message,
    body,
    related_type,
    related_id,
    link,
    is_read
  )
  SELECT
    p.user_id,
    v_project_id,
    'chat_message',
    v_sender_name,
    v_body,
    v_body,
    'chat_room',
    NEW.room_id::text,
    v_link,
    false
  FROM public.chat_participants p
  WHERE p.room_id = NEW.room_id
    AND p.left_at IS NULL
    AND p.user_id <> NEW.sender_id
    AND p.is_notification_enabled
    AND public.can_use_messenger(p.user_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_notify ON public.chat_room_messages;
CREATE TRIGGER trg_chat_message_notify
AFTER INSERT ON public.chat_room_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_chat_message();

REVOKE ALL ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_chat_message() TO authenticated, service_role;
