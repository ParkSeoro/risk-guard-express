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

-- 발주처(client) 같은 회사는 현장이 달라도 메신저에서 한 소속으로 본다.
-- 시공사·협력사는 이 함수가 false라서 기존처럼 같은 현장만 초대된다.
CREATE OR REPLACE FUNCTION public.messenger_shares_client_company(p_me uuid, p_them uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_me IS NOT NULL
     AND p_them IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.project_members mine
       JOIN public.companies mc ON mc.id = mine.company_id
       JOIN public.project_members theirs
         ON theirs.user_id = p_them
        AND theirs.company_id = mine.company_id
       WHERE mine.user_id = p_me
         AND mine.company_id IS NOT NULL
         AND lower(btrim(COALESCE(mc.type, ''))) IN ('client', '발주처', 'owner')
     );
$$;

REVOKE ALL ON FUNCTION public.messenger_shares_client_company(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.messenger_shares_client_company(uuid, uuid) TO service_role;

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
  v_room_project_id uuid;
  v_is_master boolean := false;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_use_messenger(v_my_user_id) THEN
    RAISE EXCEPTION 'Messenger is not available for this account';
  END IF;

  IF NOT public.is_chat_room_participant(p_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Not a participant of this room';
  END IF;

  SELECT project_id INTO v_room_project_id
  FROM public.chat_rooms
  WHERE id = p_room_id;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_my_user_id
      AND role = 'master'::public.global_role
  ) INTO v_is_master;

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

    -- Same project as create_chat_room, plus the same client company on another project.
    IF NOT v_is_master
       AND NOT EXISTS (
      SELECT 1
      FROM public.project_members mine
      JOIN public.project_members theirs ON theirs.project_id = mine.project_id
      WHERE mine.user_id = v_my_user_id
        AND theirs.user_id = v_uid
        AND (v_room_project_id IS NULL OR mine.project_id = v_room_project_id)
    )
       AND NOT public.messenger_shares_client_company(v_my_user_id, v_uid)
    THEN
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
    IF NOT public.can_manage_chat_room(p_room_id, v_my_user_id) THEN
      RAISE EXCEPTION 'Only the room owner can rename this room for everyone';
    END IF;

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

  IF NOT public.can_manage_chat_room(p_room_id, v_my_user_id) THEN
    RAISE EXCEPTION 'Only the room owner can pin a notice';
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
  v_sender_id uuid;
  v_sender_name text;
  v_link text;
  v_count integer := 0;
  v_allowed integer := 0;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_use_messenger(v_my_user_id) THEN
    RAISE EXCEPTION 'Messenger is not available for this account';
  END IF;

  SELECT m.room_id, m.created_at, m.sender_id, r.project_id
    INTO v_room_id, v_msg_created_at, v_sender_id, v_project_id
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

  -- One nudge per person per message each 10 minutes. -1 tells the client to wait.
  INSERT INTO public.chat_message_reminders (message_id, reminded_by, reminded_at)
  VALUES (p_message_id, v_my_user_id, now())
  ON CONFLICT (message_id, reminded_by)
  DO UPDATE SET reminded_at = now()
  WHERE public.chat_message_reminders.reminded_at < now() - interval '10 minutes';

  GET DIAGNOSTICS v_allowed = ROW_COUNT;
  IF v_allowed = 0 THEN
    RETURN -1;
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
    '확인하지 않은 메시지가 있습니다.',
    '확인하지 않은 메시지가 있습니다.',
    'chat_room',
    v_room_id::text,
    v_link,
    false
  FROM public.chat_participants p
  WHERE p.room_id = v_room_id
    AND p.left_at IS NULL
    AND p.user_id <> v_my_user_id
    AND p.user_id IS DISTINCT FROM v_sender_id
    AND (p.last_read_at IS NULL OR p.last_read_at < v_msg_created_at)
    AND p.is_notification_enabled = TRUE
    AND public.can_use_messenger(p.user_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Room-wide rename and pin stay with the creator, a master, or the site's lead roles.
CREATE OR REPLACE FUNCTION public.can_manage_chat_room(p_room_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND public.is_chat_room_participant(p_room_id, p_user_id)
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = p_user_id
          AND ur.role = 'master'::public.global_role
      )
      OR EXISTS (
        SELECT 1
        FROM public.chat_rooms r
        WHERE r.id = p_room_id
          AND r.created_by = p_user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.chat_rooms r
        JOIN public.project_members pm
          ON pm.project_id = r.project_id
         AND pm.user_id = p_user_id
        WHERE r.id = p_room_id
          AND pm.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role
          )
      )
    );
$$;

-- One unread count query for the room list. Matches the old per-room count:
-- only messages after last_read_at, not sent by me, not deleted.
CREATE OR REPLACE FUNCTION public.count_my_chat_unreads(p_room_ids uuid[])
RETURNS TABLE(room_id uuid, unread_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.room_id,
    COUNT(m.id)::integer AS unread_count
  FROM public.chat_participants p
  LEFT JOIN public.chat_room_messages m
    ON m.room_id = p.room_id
   AND COALESCE(m.is_deleted, false) = false
   AND m.sender_id <> p.user_id
   AND p.last_read_at IS NOT NULL
   AND m.created_at > p.last_read_at
  WHERE p.user_id = auth.uid()
    AND p.left_at IS NULL
    AND p.room_id = ANY(COALESCE(p_room_ids, ARRAY[]::uuid[]))
  GROUP BY p.room_id;
$$;

CREATE TABLE IF NOT EXISTS public.chat_message_reminders (
  message_id uuid NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  reminded_by uuid NOT NULL,
  reminded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, reminded_by)
);

ALTER TABLE public.chat_message_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_message_reminders FROM PUBLIC, anon, authenticated;

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

REVOKE ALL ON FUNCTION public.can_manage_chat_room(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_chat_room(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.count_my_chat_unreads(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.count_my_chat_unreads(uuid[]) TO authenticated, service_role;

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
