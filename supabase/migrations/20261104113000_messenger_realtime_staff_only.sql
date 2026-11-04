-- Messenger: live inserts, room preview, staff-only rooms.
-- Workers (project_members.role_new = worker, and no manager role) cannot open or be invited.
-- Apply this file on the live database. Merging the pull request does not run it.

CREATE OR REPLACE FUNCTION public.can_use_messenger(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        WHERE ur.user_id = p_user_id
          AND ur.role = 'master'::public.global_role
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_members pm
        WHERE pm.user_id = p_user_id
          AND pm.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role,
            'supervisor'::public.project_role,
            'site_supervisor'::public.project_role,
            'viewer'::public.project_role
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.can_use_messenger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_use_messenger(uuid) TO postgres, service_role;

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
      IF NOT v_is_master AND NOT EXISTS (
        SELECT 1
        FROM public.project_members mine
        JOIN public.project_members theirs ON theirs.project_id = mine.project_id
        WHERE mine.user_id = v_my_user_id
          AND theirs.user_id = v_user_id
          AND (p_project_id IS NULL OR mine.project_id = p_project_id)
      ) THEN
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
    )
    AND (p_project_id IS NULL OR pm.project_id = p_project_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_chat_room_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.chat_rooms
  SET
    last_message_text = left(NEW.content, 100),
    last_message_at = NEW.created_at,
    last_message_sender_id = NEW.sender_id,
    updated_at = NOW()
  WHERE id = NEW.room_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_room_messages_touch_room ON public.chat_room_messages;
CREATE TRIGGER trg_chat_room_messages_touch_room
AFTER INSERT ON public.chat_room_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_chat_room_last_message();

REVOKE ALL ON FUNCTION public.touch_chat_room_last_message() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.touch_chat_room_last_message() TO authenticated, service_role;

ALTER FUNCTION public.get_chat_message_read_receipts(uuid) SET search_path = public;
ALTER FUNCTION public.get_chat_unread_total() SET search_path = public;
ALTER FUNCTION public.mark_chat_room_read(uuid, uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.create_chat_room(character varying, boolean, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_contacts(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_message_read_receipts(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_chat_unread_total() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_chat_room_read(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_chat_room_participant(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_chat_room(character varying, boolean, uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_message_read_receipts(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_total() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_chat_room_read(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_chat_room_participant(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.chat_room_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_room_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_room_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_participants;
  END IF;
END $$;
