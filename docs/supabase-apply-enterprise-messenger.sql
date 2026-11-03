-- ====================================================================
-- SafeNex Enterprise Messenger Core Schema (Step 1)
-- 개인정보 보호 (타사 연락처 은닉) + 다단계 프로젝트 권한 격리 + GCS 스토리지 연동
-- ====================================================================

-- 1. 대화방 테이블 (전사/현장 공용)
CREATE TABLE IF NOT EXISTS public.messenger_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE, -- NULL이면 전사 대화방, UUID면 해당 현장 대화방
  name VARCHAR(150), -- 그룹방 명칭 (1:1 방은 NULL 가능)
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  pinned_message_id UUID, -- 공지 상단 고정 메시지 ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 대화방 참여자 테이블 (인당 안 읽은 카운트 및 알림 관리)
CREATE TABLE IF NOT EXISTS public.messenger_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.messenger_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_name_override VARCHAR(150), -- 개별 사용자가 설정한 방 이름 커스텀
  is_notification_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_message_id UUID,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ, -- 퇴장 시점 (이력 보존)
  UNIQUE(room_id, user_id)
);

-- 3. 메시지 테이블 (인용 답장, 텍스트/미디어 지원)
CREATE TABLE IF NOT EXISTS public.messenger_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.messenger_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.messenger_messages(id) ON DELETE SET NULL, -- 인용 답장 부모 메시지
  message_type VARCHAR(20) NOT NULL DEFAULT 'TEXT', -- TEXT, IMAGE, VIDEO, FILE, SYSTEM
  content TEXT NOT NULL DEFAULT '',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 첨부파일 테이블 (Google Cloud Storage 및 Supabase 다중 파일)
CREATE TABLE IF NOT EXISTS public.messenger_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL DEFAULT 'GCS', -- 'GCS' 또는 'SUPABASE'
  gcs_bucket VARCHAR(100) NOT NULL DEFAULT 'safenex-messenger-vault',
  gcs_blob_name TEXT NOT NULL, -- GCS 버킷 내 고유 저장 경로
  public_url TEXT, -- 만료 없는 URL 또는 썸네일 경로
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 이모지 리액션 테이블 (👍, ✅, 👀 등)
CREATE TABLE IF NOT EXISTS public.messenger_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messenger_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_messenger_rooms_project_id ON public.messenger_rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_messenger_rooms_last_message_at ON public.messenger_rooms(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messenger_participants_user_id ON public.messenger_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_messenger_participants_room_user ON public.messenger_participants(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_messenger_messages_room_created ON public.messenger_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messenger_attachments_message_id ON public.messenger_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_messenger_reactions_message_id ON public.messenger_reactions(message_id);

-- ====================================================================
-- RLS (Row Level Security) 정책
-- ====================================================================
ALTER TABLE public.messenger_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_reactions ENABLE ROW LEVEL SECURITY;

-- 1. 대화방 조회: 본인이 참여 중인 활성 대화방만 조회
CREATE POLICY "participants_can_select_room" ON public.messenger_rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messenger_participants p
      WHERE p.room_id = messenger_rooms.id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

-- 2. 대화방 생성 권한:
-- 발주처/마스터는 전사방(project_id NULL) 및 모든 현장방 생성 가능
-- 시공사/협력사는 자신이 배정된 project_id 대화방만 생성 가능
CREATE POLICY "enforce_room_creation_scope" ON public.messenger_rooms
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND (
      EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role IN ('master', 'owner_safety_manager', 'super_admin')
      )
      OR (
        project_id IS NOT NULL AND
        EXISTS (
          SELECT 1 FROM public.project_members 
          WHERE user_id = auth.uid() AND project_id = messenger_rooms.project_id
        )
      )
    )
  );

-- 3. 참여자 명단 조회: 동일 방 참여자만 조회
CREATE POLICY "participants_can_select_participants" ON public.messenger_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messenger_participants p
      WHERE p.room_id = messenger_participants.room_id AND p.user_id = auth.uid()
    )
  );

-- 4. 메시지 조회 및 등록: 해당 방 참여자만 가능
CREATE POLICY "participants_can_read_messages" ON public.messenger_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messenger_participants p
      WHERE p.room_id = messenger_messages.room_id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

CREATE POLICY "participants_can_insert_messages" ON public.messenger_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.messenger_participants p
      WHERE p.room_id = messenger_messages.room_id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

-- 5. 첨부파일 조회 및 등록: 해당 방 참여자만 가능
CREATE POLICY "participants_can_read_attachments" ON public.messenger_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.messenger_messages m
      JOIN public.messenger_participants p ON p.room_id = m.room_id
      WHERE m.id = messenger_attachments.message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

CREATE POLICY "participants_can_insert_attachments" ON public.messenger_attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.messenger_messages m
      JOIN public.messenger_participants p ON p.room_id = m.room_id
      WHERE m.id = messenger_attachments.message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

-- 6. 이모지 리액션: 참여자만 조회/추가/삭제
CREATE POLICY "participants_can_manage_reactions" ON public.messenger_reactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.messenger_messages m
      JOIN public.messenger_participants p ON p.room_id = m.room_id
      WHERE m.id = messenger_reactions.message_id AND p.user_id = auth.uid() AND p.left_at IS NULL
    )
  );

-- ====================================================================
-- RPC 함수 1: 대화상대 검색 및 개인정보 격리 (get_messenger_contacts)
-- - 타사 직원의 전화번호는 원천 차단(NULL 반환)
-- - 발주처/마스터: 전 프로젝트 검색 가능
-- - 시공사/협력사: 자신이 소속된 현장(프로젝트) 인원만 검색 가능
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_messenger_contacts(
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
DECLARE
  v_my_user_id UUID := auth.uid();
  v_my_company_id UUID;
  v_is_master_or_owner BOOLEAN;
BEGIN
  -- 1. 내 소속 회사 및 마스터/발주처 권한 확인
  SELECT company_id, 
         (role IN ('master', 'owner_safety_manager', 'super_admin'))
  INTO v_my_company_id, v_is_master_or_owner
  FROM public.profiles
  WHERE id = v_my_user_id;

  -- 2. 조건에 따른 대화 상대 목록 반환
  RETURN QUERY
  SELECT 
    pr.id AS user_id,
    pr.full_name,
    pr.company_name,
    pr.role,
    CASE 
      WHEN pr.company_id = v_my_company_id THEN pr.phone
      ELSE NULL -- 타사 직원의 전화번호는 원천 차단(보안 격리)!
    END AS phone,
    pr.avatar_url,
    (pr.company_id = v_my_company_id) AS is_same_company,
    pm.project_id
  FROM public.profiles pr
  LEFT JOIN public.project_members pm ON pm.user_id = pr.id
  WHERE pr.id != v_my_user_id
    AND pr.role IN ('master', 'owner_safety_manager', 'project_admin', 'safety_manager', 'site_manager', 'supervisor', 'site_supervisor', 'company_admin')
    AND (
      p_search_query IS NULL 
      OR pr.full_name ILIKE '%' || p_search_query || '%'
      OR pr.company_name ILIKE '%' || p_search_query || '%'
    )
    AND (
      v_is_master_or_owner = TRUE
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
-- RPC 함수 2: 라인웍스 스타일 읽은 사람 / 안 읽은 사람 산출 (get_message_read_receipts)
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_message_read_receipts(p_message_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_room_id UUID;
  v_msg_created_at TIMESTAMPTZ;
  v_my_company_id UUID;
  v_result JSONB;
BEGIN
  SELECT room_id, created_at INTO v_room_id, v_msg_created_at
  FROM public.messenger_messages
  WHERE id = p_message_id;

  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Message not found');
  END IF;

  SELECT company_id INTO v_my_company_id FROM public.profiles WHERE id = auth.uid();

  SELECT jsonb_build_object(
    'message_id', p_message_id,
    'read_count', COUNT(CASE WHEN p.last_read_at >= v_msg_created_at AND p.user_id != m.sender_id THEN 1 END),
    'unread_count', COUNT(CASE WHEN p.last_read_at < v_msg_created_at AND p.user_id != m.sender_id THEN 1 END),
    'readers', COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'name', pr.full_name,
        'company', pr.company_name,
        'role', pr.role,
        'phone', CASE WHEN pr.company_id = v_my_company_id THEN pr.phone ELSE NULL END,
        'read_at', p.last_read_at
      )
    ) FILTER (WHERE p.last_read_at >= v_msg_created_at AND p.user_id != m.sender_id), '[]'::jsonb),
    'unreaders', COALESCE(jsonb_agg(
      jsonb_build_object(
        'user_id', p.user_id,
        'name', pr.full_name,
        'company', pr.company_name,
        'role', pr.role
      )
    ) FILTER (WHERE p.last_read_at < v_msg_created_at AND p.user_id != m.sender_id), '[]'::jsonb)
  ) INTO v_result
  FROM public.messenger_participants p
  JOIN public.messenger_messages m ON m.id = p_message_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.room_id = v_room_id AND p.left_at IS NULL;

  RETURN v_result;
END;
$$;

-- ====================================================================
-- RPC 함수 3: 대화방 읽음 처리 (mark_messenger_room_read)
-- 단 1건의 UPDATE로 해당 시점 이전 모든 메시지 일괄 읽음 처리
-- ====================================================================
CREATE OR REPLACE FUNCTION public.mark_messenger_room_read(
  p_room_id UUID,
  p_last_message_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messenger_participants
  SET 
    last_read_at = NOW(),
    last_read_message_id = COALESCE(p_last_message_id, last_read_message_id)
  WHERE room_id = p_room_id AND user_id = auth.uid();
END;
$$;

-- ====================================================================
-- RPC 함수 4: 사용자의 전체 안 읽은 메시지 수 조회 (get_messenger_unread_total)
-- 웹 상단 헤더 및 모바일 하단 탭 뱃지 연동용
-- ====================================================================
CREATE OR REPLACE FUNCTION public.get_messenger_unread_total()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INTEGER := 0;
BEGIN
  SELECT COALESCE(COUNT(m.id), 0)
  INTO v_total
  FROM public.messenger_participants p
  JOIN public.messenger_messages m ON m.room_id = p.room_id
  WHERE p.user_id = auth.uid()
    AND p.left_at IS NULL
    AND m.sender_id != auth.uid()
    AND m.created_at > p.last_read_at
    AND m.is_deleted = FALSE;

  RETURN v_total;
END;
$$;
