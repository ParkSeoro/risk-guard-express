CREATE OR REPLACE FUNCTION public.open_or_create_self_chat()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_my_user_id UUID := auth.uid();
  v_room_id UUID;
BEGIN
  IF v_my_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_use_messenger(v_my_user_id) THEN
    RAISE EXCEPTION 'Messenger is not available for this account';
  END IF;

  SELECT r.id INTO v_room_id
  FROM public.chat_rooms r
  JOIN public.chat_participants p
    ON p.room_id = r.id
   AND p.user_id = v_my_user_id
   AND p.left_at IS NULL
  WHERE r.is_group = FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM public.chat_participants other_p
      WHERE other_p.room_id = r.id
        AND other_p.user_id <> v_my_user_id
        AND other_p.left_at IS NULL
    )
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
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
    '나와의 채팅',
    FALSE,
    NULL,
    v_my_user_id,
    '나와의 채팅방입니다. 메모·사진·파일을 자유롭게 보관하세요.',
    NOW(),
    v_my_user_id
  )
  RETURNING id INTO v_room_id;

  INSERT INTO public.chat_participants (room_id, user_id, last_read_at)
  VALUES (v_room_id, v_my_user_id, NOW())
  ON CONFLICT (room_id, user_id) DO NOTHING;

  RETURN v_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_or_create_self_chat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.open_or_create_self_chat() TO authenticated;
