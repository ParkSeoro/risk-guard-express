-- ====================================================================
-- SafeNex Enterprise Messenger Upgrade
-- Features:
-- 1. invite_chat_participants: Invite additional staff into a room
-- 2. leave_chat_room: Leave a chat room cleanly with system message
-- 3. set_chat_room_name: Rename room (personal override or group title)
-- 4. set_chat_pinned_message: Pin/unpin important safety notice in room
-- 5. delete_my_chat_message: Soft-delete own message
-- 6. remind_unread_chat_participants: Line Works style re-notification to unreaders
-- 7. Realtime publication for chat_reactions
-- ====================================================================

-- 1. 대화방 추가 초대
CREATE OR REPLACE FUNCTION public.invite_chat_participants(
  p_room_id uuid,
  p_user_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
  v_uid uuid;
  v_added integer := 0;
  v_names text[] := ARRAY[]::text[];
  v_display_name text;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_chat_room_participant(p_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOREACH v_uid IN ARRAY p_user_ids
  LOOP
    IF v_uid IS NULL OR v_uid = v_my_user_id THEN
      CONTINUE;
    END IF;

    IF NOT public.can_use_messenger(v_uid) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.chat_participants (room_id, user_id, last_read_at, left_at)
    VALUES (p_room_id, v_uid, NOW(), NULL)
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET left_at = NULL, joined_at = NOW(), last_read_at = NOW()
    WHERE public.chat_participants.left_at IS NOT NULL;

    IF FOUND THEN
      v_added := v_added + 1;
      SELECT COALESCE(NULLIF(btrim(display_name), ''), '관리자')
        INTO v_display_name
      FROM public.profiles
      WHERE user_id = v_uid;
      v_names := array_append(v_names, COALESCE(v_display_name, '관리자'));
    END IF;
  END LOOP;

  IF v_added > 0 THEN
    UPDATE public.chat_rooms
    SET is_group = TRUE,
        updated_at = NOW()
    WHERE id = p_room_id;

    INSERT INTO public.chat_room_messages (room_id, sender_id, message_type, content)
    VALUES (
      p_room_id,
      v_my_user_id,
      'SYSTEM',
      array_to_string(v_names, ', ') || '님이 대화방에 초대되었습니다.'
    );
  END IF;

  RETURN v_added;
END;
$$;

-- 2. 대화방 나가기
CREATE OR REPLACE FUNCTION public.leave_chat_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
  v_my_name text;
  v_updated integer := 0;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.chat_participants
  SET left_at = NOW()
  WHERE room_id = p_room_id
    AND user_id = v_my_user_id
    AND left_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    SELECT COALESCE(NULLIF(btrim(display_name), ''), '관리자')
      INTO v_my_name
    FROM public.profiles
    WHERE user_id = v_my_user_id;

    INSERT INTO public.chat_room_messages (room_id, sender_id, message_type, content)
    VALUES (
      p_room_id,
      v_my_user_id,
      'SYSTEM',
      COALESCE(v_my_name, '관리자') || '님이 대화방을 나갔습니다.'
    );
  END IF;

  RETURN v_updated > 0;
END;
$$;

-- 3. 대화방 이름 변경 (개인 설정 또는 공용 그룹명)
CREATE OR REPLACE FUNCTION public.set_chat_room_name(
  p_room_id uuid,
  p_name text,
  p_for_everyone boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
  v_clean_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_chat_room_participant(p_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  IF p_for_everyone THEN
    UPDATE public.chat_rooms
    SET name = left(v_clean_name, 150),
        updated_at = NOW()
    WHERE id = p_room_id;
  ELSE
    UPDATE public.chat_participants
    SET room_name_override = left(v_clean_name, 150)
    WHERE room_id = p_room_id
      AND user_id = v_my_user_id
      AND left_at IS NULL;
  END IF;

  RETURN TRUE;
END;
$$;

-- 4. 대화방 상단 공지 고정 / 해제
CREATE OR REPLACE FUNCTION public.set_chat_pinned_message(
  p_room_id uuid,
  p_message_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_chat_room_participant(p_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.chat_room_messages
    WHERE id = p_message_id
      AND room_id = p_room_id
      AND is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION 'Message does not belong to this room';
  END IF;

  UPDATE public.chat_rooms
  SET pinned_message_id = p_message_id,
      updated_at = NOW()
  WHERE id = p_room_id;

  RETURN TRUE;
END;
$$;

-- 5. 본인 메시지 삭제 (회수)
CREATE OR REPLACE FUNCTION public.delete_my_chat_message(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
  v_updated integer := 0;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.chat_room_messages
  SET is_deleted = TRUE,
      content = '삭제된 메시지입니다.',
      updated_at = NOW()
  WHERE id = p_message_id
    AND sender_id = v_my_user_id
    AND is_deleted = FALSE;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

-- 6. 미확인자 재알림 (라인웍스/네이버웍스 스타일 콕 찌르기)
CREATE OR REPLACE FUNCTION public.remind_unread_chat_participants(p_message_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id uuid := auth.uid();
  v_room_id uuid;
  v_project_id uuid;
  v_msg_created_at timestamptz;
  v_msg_content text;
  v_sender_name text;
  v_link text;
  v_count integer := 0;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.room_id, m.created_at, m.content, r.project_id
    INTO v_room_id, v_msg_created_at, v_msg_content, v_project_id
  FROM public.chat_room_messages m
  JOIN public.chat_rooms r ON r.id = m.room_id
  WHERE m.id = p_message_id
    AND m.is_deleted = FALSE;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF NOT public.is_chat_room_participant(v_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  SELECT COALESCE(NULLIF(btrim(display_name), ''), '관리자')
    INTO v_sender_name
  FROM public.profiles
  WHERE user_id = v_my_user_id;

  v_link := '/app/admin/messenger?room=' || v_room_id::text;

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
    '[미확인 재알림] ' || COALESCE(v_sender_name, '관리자'),
    left(COALESCE(NULLIF(btrim(v_msg_content), ''), '중요 메시지를 확인해 주세요.'), 80),
    left(COALESCE(NULLIF(btrim(v_msg_content), ''), '중요 메시지를 확인해 주세요.'), 80),
    'chat_room',
    v_room_id::text,
    v_link,
    false
  FROM public.chat_participants p
  WHERE p.room_id = v_room_id
    AND p.left_at IS NULL
    AND p.user_id <> v_my_user_id
    AND p.last_read_at < v_msg_created_at
    AND p.is_notification_enabled = TRUE
    AND public.can_use_messenger(p.user_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.invite_chat_participants(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.leave_chat_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_chat_room_name(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_chat_pinned_message(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_my_chat_message(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remind_unread_chat_participants(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.invite_chat_participants(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.leave_chat_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_chat_room_name(uuid, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_chat_pinned_message(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_chat_message(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remind_unread_chat_participants(uuid) TO authenticated, service_role;

ALTER TABLE public.chat_reactions REPLICA IDENTITY FULL;
ALTER TABLE public.chat_rooms REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_reactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_rooms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
  END IF;
END $$;
