-- While a room is on screen, that person gets the message in the open chat and no push.
-- A group room's creator can delete it for everyone.
-- A master directory lists project admins from every project, not only the selected one.

CREATE TABLE IF NOT EXISTS public.chat_room_presence (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_room_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_room_presence FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_chat_room_presence(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_room_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_participants
    WHERE room_id = p_room_id
      AND user_id = auth.uid()
      AND left_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.chat_room_presence (user_id, room_id, updated_at)
  VALUES (auth.uid(), p_room_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET room_id = EXCLUDED.room_id,
        updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_chat_room_presence(p_room_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.chat_room_presence
  WHERE user_id = auth.uid()
    AND (p_room_id IS NULL OR room_id = p_room_id);
END;
$$;

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
    AND public.can_use_messenger(p.user_id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_room_presence pres
      WHERE pres.user_id = p.user_id
        AND pres.room_id = NEW.room_id
        AND pres.updated_at > now() - interval '25 seconds'
    );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_chat_room(p_room_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_created_by uuid;
  v_is_group boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT created_by, is_group
    INTO v_created_by, v_is_group
  FROM public.chat_rooms
  WHERE id = p_room_id;

  IF v_created_by IS NULL THEN
    RAISE EXCEPTION 'Room not found';
  END IF;

  IF v_is_group IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a group room can be deleted';
  END IF;

  IF v_created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the room creator can delete this room';
  END IF;

  DELETE FROM public.notifications
  WHERE related_type = 'chat_room'
    AND related_id = p_room_id::text;

  DELETE FROM public.chat_rooms
  WHERE id = p_room_id;

  RETURN true;
END;
$$;

DROP FUNCTION IF EXISTS public.get_chat_contacts(uuid, text);

CREATE FUNCTION public.get_chat_contacts(
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
  project_id uuid,
  project_label text
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

  IF v_is_master THEN
    RETURN QUERY
    SELECT
      pr.user_id,
      pr.display_name,
      pr.company,
      '프로젝트 관리자'::text,
      CASE
        WHEN pr.company IS NOT NULL AND pr.company = v_my_company THEN pr.phone
        ELSE NULL
      END,
      NULL::text,
      (pr.company IS NOT NULL AND pr.company = v_my_company),
      NULL::uuid,
      string_agg(DISTINCT proj.name, ', ' ORDER BY proj.name)
    FROM public.profiles pr
    JOIN public.project_members pm
      ON pm.user_id = pr.user_id
     AND pm.role_new = 'project_admin'::public.project_role
    JOIN public.projects proj
      ON proj.id = pm.project_id
     AND COALESCE(proj.is_deleted, false) = false
    WHERE pr.user_id <> v_my_user_id
      AND pr.account_status = 'active'
      AND public.can_use_messenger(pr.user_id)
      AND (
        p_search_query IS NULL
        OR pr.display_name ILIKE '%' || p_search_query || '%'
        OR pr.company ILIKE '%' || p_search_query || '%'
        OR proj.name ILIKE '%' || p_search_query || '%'
      )
    GROUP BY pr.user_id, pr.display_name, pr.company, pr.phone;
    RETURN;
  END IF;

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
    NULL::text,
    (pr.company IS NOT NULL AND pr.company = v_my_company),
    pm.project_id,
    NULL::text
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
      pm.project_id IN (
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

REVOKE ALL ON FUNCTION public.touch_chat_room_presence(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_chat_room_presence(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_chat_room(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_chat_contacts(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.touch_chat_room_presence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_chat_room_presence(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_chat_room(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notify_chat_message() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts(uuid, text) TO authenticated, service_role;
