-- 발주처는 다른 현장의 같은 회사 관리자도 메신저 명단에서 본다.
-- 회사 이름은 고정하지 않는다. companies.type 이 client/발주처/owner 이고
-- project_members.company_id 가 같은 사람만 포함한다.
-- 시공사·협력사는 기존처럼 같이 들어간 현장만 본다.

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

CREATE OR REPLACE FUNCTION public.create_chat_room(
  p_name character varying,
  p_is_group boolean,
  p_project_id uuid,
  p_invite_user_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id UUID := auth.uid();
  v_room_id UUID;
  v_target_user_id UUID;
  v_existing_room_id UUID;
  v_user_id UUID;
  v_is_master BOOLEAN;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_use_messenger(v_my_user_id) THEN
    RAISE EXCEPTION 'Messenger is not available for this account';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = v_my_user_id
      AND role = 'master'::public.global_role
  ) INTO v_is_master;

  IF p_project_id IS NOT NULL AND NOT v_is_master AND NOT EXISTS (
    SELECT 1
    FROM public.project_members
    WHERE user_id = v_my_user_id
      AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Not a member of this project';
  END IF;

  IF p_invite_user_ids IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_invite_user_ids
    LOOP
      IF v_user_id IS NULL OR v_user_id = v_my_user_id THEN
        CONTINUE;
      END IF;
      IF NOT public.can_use_messenger(v_user_id) THEN
        RAISE EXCEPTION 'Invitee cannot use messenger';
      END IF;
      IF NOT v_is_master
         AND NOT EXISTS (
           SELECT 1
           FROM public.project_members mine
           JOIN public.project_members theirs ON theirs.project_id = mine.project_id
           WHERE mine.user_id = v_my_user_id
             AND theirs.user_id = v_user_id
             AND (p_project_id IS NULL OR mine.project_id = p_project_id)
         )
         AND NOT public.messenger_shares_client_company(v_my_user_id, v_user_id)
      THEN
        RAISE EXCEPTION 'Invitee is outside your projects';
      END IF;
    END LOOP;
  END IF;

  IF p_is_group = FALSE AND array_length(p_invite_user_ids, 1) = 1 THEN
    v_target_user_id := p_invite_user_ids[1];

    SELECT r.id INTO v_existing_room_id
    FROM public.chat_rooms r
    JOIN public.chat_participants p1
      ON p1.room_id = r.id AND p1.user_id = v_my_user_id AND p1.left_at IS NULL
    JOIN public.chat_participants p2
      ON p2.room_id = r.id AND p2.user_id = v_target_user_id AND p2.left_at IS NULL
    WHERE r.is_group = FALSE
    LIMIT 1;

    IF v_existing_room_id IS NOT NULL THEN
      RETURN v_existing_room_id;
    END IF;
  END IF;

  INSERT INTO public.chat_rooms (
    name,
    is_group,
    project_id,
    created_by,
    last_message_text,
    last_message_at,
    last_message_sender_id
  ) VALUES (
    p_name,
    p_is_group,
    p_project_id,
    v_my_user_id,
    '대화방이 개설되었습니다.',
    NOW(),
    v_my_user_id
  )
  RETURNING id INTO v_room_id;

  INSERT INTO public.chat_participants (room_id, user_id, last_read_at)
  VALUES (v_room_id, v_my_user_id, NOW());

  IF p_invite_user_ids IS NOT NULL THEN
    FOREACH v_user_id IN ARRAY p_invite_user_ids
    LOOP
      IF v_user_id IS NOT NULL AND v_user_id <> v_my_user_id THEN
        INSERT INTO public.chat_participants (room_id, user_id, last_read_at)
        VALUES (v_room_id, v_user_id, NOW())
        ON CONFLICT (room_id, user_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.chat_room_messages (room_id, sender_id, message_type, content)
  VALUES (v_room_id, v_my_user_id, 'SYSTEM', '대화방이 개설되었습니다.');

  RETURN v_room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_contacts(
  p_project_id uuid DEFAULT NULL,
  p_search_query text DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  company_name text,
  role text,
  phone text,
  avatar_url text,
  is_same_company boolean,
  project_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_my_user_id UUID := auth.uid();
  v_my_company TEXT;
  v_is_master BOOLEAN;
BEGIN
  IF v_my_user_id IS NULL OR NOT public.can_use_messenger(v_my_user_id) THEN
    RETURN;
  END IF;

  SELECT company INTO v_my_company FROM public.profiles WHERE profiles.user_id = v_my_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = v_my_user_id
      AND user_roles.role = 'master'::public.global_role
  ) INTO v_is_master;

  RETURN QUERY
  SELECT
    pr.user_id,
    pr.display_name,
    pr.company,
    pr.position,
    CASE
      WHEN pr.company IS NOT NULL AND pr.company = v_my_company THEN pr.phone
      ELSE NULL
    END,
    NULL::TEXT,
    (pr.company IS NOT NULL AND pr.company = v_my_company),
    pm.project_id
  FROM public.profiles pr
  LEFT JOIN public.project_members pm ON pm.user_id = pr.user_id
  WHERE pr.user_id <> v_my_user_id
    AND pr.account_status = 'active'
    AND public.can_use_messenger(pr.user_id)
    AND (
      p_search_query IS NULL
      OR pr.display_name ILIKE '%' || p_search_query || '%'
      OR pr.company ILIKE '%' || p_search_query || '%'
    )
    AND (
      v_is_master = TRUE
      OR pm.project_id IN (
        SELECT my_pm.project_id
        FROM public.project_members my_pm
        WHERE my_pm.user_id = v_my_user_id
      )
      OR public.messenger_shares_client_company(v_my_user_id, pr.user_id)
    )
    AND (
      p_project_id IS NULL
      OR pm.project_id = p_project_id
      OR public.messenger_shares_client_company(v_my_user_id, pr.user_id)
    );
END;
$$;

-- 이미 적용된 invite_chat_participants 도 같은 예외를 쓰게 다시 만든다.
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
