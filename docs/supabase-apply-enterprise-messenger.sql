-- ====================================================================
-- SafeNex Enterprise Messenger Core Schema (Step 1 - 최종 완성본)
-- 테이블: chat_rooms, chat_participants, chat_room_messages, chat_attachments, chat_reactions
-- ====================================================================

-- 1. 대화방 테이블 (전사/현장 공용)
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name VARCHAR(150),
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pinned_message_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 대화방 참여자 테이블
CREATE TABLE IF NOT EXISTS public.chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_name_override VARCHAR(150),
  is_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_message_id UUID,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE(room_id, user_id)
);

-- 3. 메시지 테이블 (기존 AI chat_messages와 분리)
CREATE TABLE IF NOT EXISTS public.chat_room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.chat_room_messages(id) ON DELETE SET NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'TEXT',
  content TEXT NOT NULL DEFAULT '',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 첨부파일 테이블 (Google Cloud Storage 연동)
CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL DEFAULT 'GCS',
  gcs_bucket VARCHAR(100) NOT NULL DEFAULT 'safenex-messenger-vault',
  gcs_blob_name TEXT NOT NULL,
  public_url TEXT,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 이모지 리액션 테이블
CREATE TABLE IF NOT EXISTS public.chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_chat_rooms_project_id ON public.chat_rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_last_message_at ON public.chat_rooms(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON public.chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_room_user ON public.chat_participants(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room_created ON public.chat_room_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message_id ON public.chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message_id ON public.chat_reactions(message_id);

-- RLS 활성화
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;

-- 0. RLS 무한 재귀 방지를 위한 고속 참여자 검증 함수 (SECURITY DEFINER)
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

-- RLS 정책 설정
DO $$ 
BEGIN
  -- 1. 대화방: 본인이 속한 방만 조회 (비참여자 방 완전 차단)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_rooms' AND policyname = 'participants_can_select_room'
  ) THEN
    CREATE POLICY "participants_can_select_room" ON public.chat_rooms
      FOR SELECT USING (
        public.is_chat_room_participant(id, auth.uid())
      );
  END IF;

  -- 2. 대화방: 본인 소속 프로젝트 또는 마스터만 방 생성 가능
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_rooms' AND policyname = 'enforce_room_creation_scope'
  ) THEN
    CREATE POLICY "enforce_room_creation_scope" ON public.chat_rooms
      FOR INSERT WITH CHECK (
        created_by = auth.uid() AND (
          EXISTS (
            SELECT 1 FROM public.user_roles 
            WHERE user_id = auth.uid() AND role = 'master'::public.global_role
          )
          OR (
            project_id IS NOT NULL AND
            EXISTS (
              SELECT 1 FROM public.project_members 
              WHERE user_id = auth.uid() AND project_id = chat_rooms.project_id
            )
          )
        )
      );
  END IF;

  -- 3. 참여자: 같은 방 참여자 목록만 조회
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_participants' AND policyname = 'participants_can_select_participants'
  ) THEN
    CREATE POLICY "participants_can_select_participants" ON public.chat_participants
      FOR SELECT USING (
        user_id = auth.uid() OR public.is_chat_room_participant(room_id, auth.uid())
      );
  END IF;

  -- 4. 메시지: 참여 중인 방만 읽기/쓰기
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_room_messages' AND policyname = 'participants_can_read_messages'
  ) THEN
    CREATE POLICY "participants_can_read_messages" ON public.chat_room_messages
      FOR SELECT USING (
        public.is_chat_room_participant(room_id, auth.uid())
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_room_messages' AND policyname = 'participants_can_insert_messages'
  ) THEN
    CREATE POLICY "participants_can_insert_messages" ON public.chat_room_messages
      FOR INSERT WITH CHECK (
        sender_id = auth.uid() AND public.is_chat_room_participant(room_id, auth.uid())
      );
  END IF;

  -- 5. 첨부파일: 해당 방 참여자만 파일 정보 조회 및 다운로드
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_attachments' AND policyname = 'participants_can_read_attachments'
  ) THEN
    CREATE POLICY "participants_can_read_attachments" ON public.chat_attachments
      FOR SELECT USING (
        EXISTS (
          SELECT 1 FROM public.chat_room_messages m
          WHERE m.id = chat_attachments.message_id AND public.is_chat_room_participant(m.room_id, auth.uid())
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_attachments' AND policyname = 'participants_can_insert_attachments'
  ) THEN
    CREATE POLICY "participants_can_insert_attachments" ON public.chat_attachments
      FOR INSERT WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.chat_room_messages m
          JOIN public.chat_participants p ON p.room_id = m.room_id
          WHERE m.id = chat_attachments.message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
        )
      );
  END IF;

  -- 6. 리액션: 참여자만 조작
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_reactions' AND policyname = 'participants_can_manage_reactions'
  ) THEN
    CREATE POLICY "participants_can_manage_reactions" ON public.chat_reactions
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.chat_room_messages m
          WHERE m.id = chat_reactions.message_id AND public.is_chat_room_participant(m.room_id, auth.uid())
        )
      );
  END IF;
END $$;

-- ====================================================================
-- RPC 함수 1: 대화상대 검색 및 개인정보 격리 (get_chat_contacts)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_chat_contacts(
  p_project_id UUID DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  company_name TEXT,
  role TEXT,
  phone TEXT,
  avatar_url TEXT,
  is_same_company BOOLEAN,
  project_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
#variable_conflict use_column
DECLARE
  v_my_user_id UUID := auth.uid();
  v_my_company TEXT;
  v_is_master BOOLEAN;
BEGIN
  -- 내 소속 회사명 및 마스터 권한 확인
  SELECT company INTO v_my_company FROM public.profiles WHERE profiles.user_id = v_my_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_roles.user_id = v_my_user_id AND user_roles.role = 'master'::public.global_role
  ) INTO v_is_master;

  RETURN QUERY
  SELECT 
    pr.user_id,
    pr.display_name,
    pr.company,
    pr.position,
    CASE 
      WHEN pr.company IS NOT NULL AND pr.company = v_my_company THEN pr.phone
      ELSE NULL -- 타사 직원의 전화번호는 원천 차단!
    END,
    NULL::TEXT,
    (pr.company IS NOT NULL AND pr.company = v_my_company),
    pm.project_id
  FROM public.profiles pr
  LEFT JOIN public.project_members pm ON pm.user_id = pr.user_id
  WHERE pr.user_id != v_my_user_id
    AND pr.account_status = 'active'
    AND (
      p_search_query IS NULL 
      OR pr.display_name ILIKE '%' || p_search_query || '%'
      OR pr.company ILIKE '%' || p_search_query || '%'
    )
    AND (
      v_is_master = TRUE
      OR (
        pm.project_id IN (
          SELECT my_pm.project_id 
          FROM public.project_members my_pm 
          WHERE my_pm.user_id = v_my_user_id
        )
      )
    )
    AND (
      p_project_id IS NULL OR pm.project_id = p_project_id
    );
END;
$$;

-- ====================================================================
-- RPC 함수 2: 라인웍스 스타일 읽은 사람 / 안 읽은 사람 산출 (get_chat_message_read_receipts)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_chat_message_read_receipts(p_message_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room_id UUID;
  v_msg_created_at TIMESTAMPTZ;
  v_my_company TEXT;
  v_result JSONB;
BEGIN
  SELECT room_id, created_at INTO v_room_id, v_msg_created_at
  FROM public.chat_room_messages
  WHERE id = p_message_id;

  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Message not found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.chat_participants 
    WHERE room_id = v_room_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  SELECT company INTO v_my_company FROM public.profiles WHERE user_id = auth.uid();

  SELECT jsonb_build_object(
    'message_id', p_message_id,
    'read_count', COUNT(CASE WHEN p.last_read_at >= v_msg_created_at AND p.user_id != m.sender_id THEN 1 END),
    'unread_count', COUNT(CASE WHEN p.last_read_at < v_msg_created_at AND p.user_id != m.sender_id THEN 1 END),
    'readers', COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'name', pr.display_name,
        'company', pr.company,
        'role', pr.position,
        'phone', CASE WHEN pr.company IS NOT NULL AND pr.company = v_my_company THEN pr.phone ELSE NULL END,
        'read_at', p.last_read_at
      )
    ) FILTER (WHERE p.last_read_at >= v_msg_created_at AND p.user_id != m.sender_id), '[]'::jsonb),
    'unreaders', COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'name', pr.display_name,
        'company', pr.company,
        'role', pr.position
      )
    ) FILTER (WHERE p.last_read_at < v_msg_created_at AND p.user_id != m.sender_id), '[]'::jsonb)
  ) INTO v_result
  FROM public.chat_participants p
  JOIN public.chat_room_messages m ON m.id = p_message_id
  LEFT JOIN public.profiles pr ON pr.user_id = p.user_id
  WHERE p.room_id = v_room_id AND p.left_at IS NULL;

  RETURN v_result;
END;
$$;

-- ====================================================================
-- RPC 함수 3: 대화방 읽음 처리 (mark_chat_room_read)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.mark_chat_room_read(
  p_room_id UUID,
  p_last_message_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.chat_participants
  SET 
    last_read_at = NOW(),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE room_id = p_room_id AND user_id = auth.uid();
END;
$$;

-- ====================================================================
-- RPC 함수 4: 사용자의 전체 안 읽은 메시지 수 조회 (get_chat_unread_total)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_chat_unread_total()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER := 0;
BEGIN
  SELECT COALESCE(COUNT(m.id), 0)
  INTO v_total
  FROM public.chat_participants p
  JOIN public.chat_room_messages m ON m.room_id = p.room_id
  WHERE p.user_id = auth.uid()
    AND p.left_at IS NULL
    AND m.sender_id != auth.uid()
    AND m.created_at > p.last_read_at
    AND m.is_deleted = FALSE;

  RETURN v_total;
END;
$$;
