-- ====================================================================
-- SafeNex Enterprise Messenger RLS 무한 재귀(Infinite Recursion) 해결 패치
-- SECURITY DEFINER 함수(is_chat_room_participant)를 도입하여 RLS 순환 참조 원천 해결
-- ====================================================================

-- 1. 대화방 참여 여부 검증 보안 함수 (RLS 우회하여 고속 실행)
CREATE OR REPLACE FUNCTION public.is_chat_room_participant(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_participants
    WHERE room_id = p_room_id AND user_id = p_user_id AND left_at IS NULL
  );
$$;

-- 2. 기존 정책 교체 (DROP POLICY 후 재생성)
DROP POLICY IF EXISTS "participants_can_select_room" ON public.chat_rooms;
CREATE POLICY "participants_can_select_room" ON public.chat_rooms
  FOR SELECT USING (
    public.is_chat_room_participant(id, auth.uid())
  );

DROP POLICY IF EXISTS "participants_can_select_participants" ON public.chat_participants;
CREATE POLICY "participants_can_select_participants" ON public.chat_participants
  FOR SELECT USING (
    user_id = auth.uid() OR public.is_chat_room_participant(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "participants_can_read_messages" ON public.chat_room_messages;
CREATE POLICY "participants_can_read_messages" ON public.chat_room_messages
  FOR SELECT USING (
    public.is_chat_room_participant(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "participants_can_insert_messages" ON public.chat_room_messages;
CREATE POLICY "participants_can_insert_messages" ON public.chat_room_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND public.is_chat_room_participant(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "participants_can_read_attachments" ON public.chat_attachments;
CREATE POLICY "participants_can_read_attachments" ON public.chat_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      WHERE m.id = chat_attachments.message_id AND public.is_chat_room_participant(m.room_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "participants_can_insert_attachments" ON public.chat_attachments;
CREATE POLICY "participants_can_insert_attachments" ON public.chat_attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      WHERE m.id = chat_attachments.message_id AND public.is_chat_room_participant(m.room_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "participants_can_manage_reactions" ON public.chat_reactions;
CREATE POLICY "participants_can_manage_reactions" ON public.chat_reactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      WHERE m.id = chat_reactions.message_id AND public.is_chat_room_participant(m.room_id, auth.uid())
    )
  );
