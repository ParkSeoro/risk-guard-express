-- ====================================================================
-- SafeNex Enterprise Messenger Core Schema (Step 1)
-- 테이블: chat_rooms, chat_participants, chat_room_messages, chat_attachments, chat_reactions
-- (기존 AI 안전비서의 chat_messages 테이블과 100% 분리하여 무중단 보장)
-- 보안: 본인이 참여하지 않은 방/메시지/파일 절대 조회 불가 (RLS 철저 차단)
-- ====================================================================

-- 1. 대화방 테이블 (전사/현장 공용)
CREATE TABLE IF NOT EXISTS public.chat_rooms (
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
CREATE TABLE IF NOT EXISTS public.chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
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
-- (주의: 기존 AI 어시스턴트의 chat_messages 충돌 방지를 위해 chat_room_messages로 명명)
CREATE TABLE IF NOT EXISTS public.chat_room_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.chat_room_messages(id) ON DELETE SET NULL, -- 인용 답장 부모 메시지
  message_type VARCHAR(20) NOT NULL DEFAULT 'TEXT', -- TEXT, IMAGE, VIDEO, FILE, SYSTEM
  content TEXT NOT NULL DEFAULT '',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. 첨부파일 테이블 (Google Cloud Storage 및 다중 파일)
CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  mime_type VARCHAR(100) NOT NULL,
  storage_provider VARCHAR(20) NOT NULL DEFAULT 'GCS', -- 'GCS' 또는 'SUPABASE'
  gcs_bucket VARCHAR(100) NOT NULL DEFAULT 'safenex-messenger-vault',
  gcs_blob_name TEXT NOT NULL, -- GCS 버킷 내 고유 저장 경로
  public_url TEXT, -- 공개/정적 URL (필요 시)
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. 이모지 리액션 테이블 (👍, ✅, 👀 등)
CREATE TABLE IF NOT EXISTS public.chat_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.chat_room_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji VARCHAR(20) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);

-- 인덱스 최적화
CREATE INDEX IF NOT EXISTS idx_chat_rooms_project_id ON public.chat_rooms(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_last_message_at ON public.chat_rooms(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_id ON public.chat_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_room_user ON public.chat_participants(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_room_messages_room_created ON public.chat_room_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message_id ON public.chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reactions_message_id ON public.chat_reactions(message_id);

-- ====================================================================
-- RLS (Row Level Security) 정책: 참여자 외 절대 열람 불가
-- ====================================================================
ALTER TABLE public.chat_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;

-- 1. 대화방(chat_rooms) 보안 정책:
-- 내가 참여하지 않은 대화방(다른 사람이 만든 방 포함)은 절대 조회되지 않음!
DROP POLICY IF EXISTS "participants_can_select_room" ON public.chat_rooms;
CREATE POLICY "participants_can_select_room" ON public.chat_rooms
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants p
      WHERE p.room_id = chat_rooms.id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

-- 대화방 생성 정책: 본인이 소속된 프로젝트 또는 마스터만 생성 가능
DROP POLICY IF EXISTS "enforce_room_creation_scope" ON public.chat_rooms;
CREATE POLICY "enforce_room_creation_scope" ON public.chat_rooms
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
          WHERE user_id = auth.uid() AND project_id = chat_rooms.project_id
        )
      )
    )
  );

-- 2. 참여자(chat_participants) 보안 정책:
-- 내가 속한 방의 참여자 명단만 조회 가능
DROP POLICY IF EXISTS "participants_can_select_participants" ON public.chat_participants;
CREATE POLICY "participants_can_select_participants" ON public.chat_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants my_p
      WHERE my_p.room_id = chat_participants.room_id 
        AND my_p.user_id = auth.uid()
        AND my_p.left_at IS NULL
    )
  );

-- 3. 메시지(chat_room_messages) 보안 정책:
-- 내가 참여하고 있는 대화방의 메시지만 읽기/쓰기 가능
DROP POLICY IF EXISTS "participants_can_read_messages" ON public.chat_room_messages;
CREATE POLICY "participants_can_read_messages" ON public.chat_room_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_participants p
      WHERE p.room_id = chat_room_messages.room_id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "participants_can_insert_messages" ON public.chat_room_messages;
CREATE POLICY "participants_can_insert_messages" ON public.chat_room_messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM public.chat_participants p
      WHERE p.room_id = chat_room_messages.room_id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

-- 4. 첨부파일(chat_attachments) 보안 정책:
-- 해당 파일이 전송된 대화방의 활성 참여자만 파일 정보 조회 및 다운로드 가능!
DROP POLICY IF EXISTS "participants_can_read_attachments" ON public.chat_attachments;
CREATE POLICY "participants_can_read_attachments" ON public.chat_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      JOIN public.chat_participants p ON p.room_id = m.room_id
      WHERE m.id = chat_attachments.message_id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

DROP POLICY IF EXISTS "participants_can_insert_attachments" ON public.chat_attachments;
CREATE POLICY "participants_can_insert_attachments" ON public.chat_attachments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      JOIN public.chat_participants p ON p.room_id = m.room_id
      WHERE m.id = chat_attachments.message_id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

-- 5. 이모지 리액션 보안 정책
DROP POLICY IF EXISTS "participants_can_manage_reactions" ON public.chat_reactions;
CREATE POLICY "participants_can_manage_reactions" ON public.chat_reactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.chat_room_messages m
      JOIN public.chat_participants p ON p.room_id = m.room_id
      WHERE m.id = chat_reactions.message_id 
        AND p.user_id = auth.uid() 
        AND p.left_at IS NULL
    )
  );

-- ====================================================================
-- RPC 함수 1: 대화상대 검색 및 개인정보 격리 (get_chat_contacts)
-- - 타사 직원의 전화번호는 원천 차단(NULL 반환)
-- - 발주처/마스터: 전 프로젝트 검색 가능
-- - 시공사/협력사: 자신이 소속된 현장(프로젝트) 인원만 검색 가능
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
  v_my_company_id UUID;
  v_result JSONB;
BEGIN
  SELECT room_id, created_at INTO v_room_id, v_msg_created_at
  FROM public.chat_room_messages
  WHERE id = p_message_id;

  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Message not found');
  END IF;

  -- 호출자가 해당 방 참여자인지 보안 검증
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_participants 
    WHERE room_id = v_room_id AND user_id = auth.uid() AND left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
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
  FROM public.chat_participants p
  JOIN public.chat_room_messages m ON m.id = p_message_id
  LEFT JOIN public.profiles pr ON pr.id = p.user_id
  WHERE p.room_id = v_room_id AND p.left_at IS NULL;

  RETURN v_result;
END;
$$;

-- ====================================================================
-- RPC 함수 3: 대화방 읽음 처리 (mark_chat_room_read)
-- 단 1건의 UPDATE로 해당 시점 이전 모든 메시지 일괄 읽음 처리
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
-- 웹 상단 헤더 및 모바일 하단 탭 뱃지 연동용 (초고속 집계)
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
