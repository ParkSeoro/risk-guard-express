-- Phase 1 Foundation: Storage Archive Registry + Restore Cache + Self-Chat/Attachment Key Hygiene
-- Agreed in PR #684 (Antigravity <-> Cursor 7-clause consensus, Director approved 60-day default).
-- Note: Purge remains OFF until copy/checksum/restore/PDF/print E2E verification is complete.

-- 1. Private short-lived restore cache bucket (5-min Signed URLs for restored archived objects)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('archive-restore-cache', 'archive-restore-cache', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- 2. Universal multi-tenant archive registry (service_role only; never expose gdrive_file_id to clients)
CREATE TABLE IF NOT EXISTS public.storage_archive_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL DEFAULT 'attachments',
  object_path text NOT NULL,
  domain text NOT NULL DEFAULT 'other',
  project_id uuid NULL,
  company_id uuid NULL,
  file_size bigint NULL,
  mime_type text NULL,
  sha256_hash text NULL,
  storage_provider text NOT NULL DEFAULT 'SUPABASE',
  gdrive_file_id text NULL,
  gdrive_folder_path text NULL,
  archive_status text NOT NULL DEFAULT 'active',
  never_purge boolean NOT NULL DEFAULT true,
  legal_hold boolean NOT NULL DEFAULT false,
  source_created_at timestamptz NULL,
  backed_up_at timestamptz NULL,
  verified_at timestamptz NULL,
  purged_at timestamptz NULL,
  last_restored_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_archive_registry_bucket_path_uniq UNIQUE (bucket_id, object_path),
  CONSTRAINT storage_archive_registry_status_chk CHECK (archive_status IN ('active', 'backed_up', 'archived_purged', 'failed')),
  CONSTRAINT storage_archive_registry_provider_chk CHECK (storage_provider IN ('SUPABASE', 'GDRIVE'))
);

CREATE INDEX IF NOT EXISTS idx_storage_archive_registry_purged_lookup
  ON public.storage_archive_registry (bucket_id, object_path)
  WHERE archive_status = 'archived_purged';

CREATE INDEX IF NOT EXISTS idx_storage_archive_registry_status_age
  ON public.storage_archive_registry (archive_status, source_created_at);

CREATE INDEX IF NOT EXISTS idx_storage_archive_registry_project
  ON public.storage_archive_registry (project_id)
  WHERE project_id IS NOT NULL;

ALTER TABLE public.storage_archive_registry ENABLE ROW LEVEL SECURITY;

-- 3. Nightly backup / purge audit runs table (service_role only)
CREATE TABLE IF NOT EXISTS public.storage_backup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'backup_only',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  copied_cnt integer NOT NULL DEFAULT 0,
  verified_cnt integer NOT NULL DEFAULT 0,
  purged_cnt integer NOT NULL DEFAULT 0,
  skipped_cnt integer NOT NULL DEFAULT 0,
  error_cnt integer NOT NULL DEFAULT 0,
  circuit_broken boolean NOT NULL DEFAULT false,
  quota_used_bytes bigint NULL,
  quota_limit_bytes bigint NULL,
  notes text NULL
);

ALTER TABLE public.storage_backup_runs ENABLE ROW LEVEL SECURITY;

-- 4. Safe authenticated lookup RPC: returns ONLY object_path + archive_status for archived_purged items
-- (Zero exposure of gdrive_file_id, folder paths, or tenant metadata)
CREATE OR REPLACE FUNCTION public.check_archived_storage_paths(_paths text[])
RETURNS TABLE(object_path text, archive_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF _paths IS NULL OR array_length(_paths, 1) IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT r.object_path, r.archive_status
  FROM public.storage_archive_registry r
  WHERE r.bucket_id = 'attachments'
    AND r.archive_status = 'archived_purged'
    AND r.object_path = ANY(_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.check_archived_storage_paths(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_archived_storage_paths(text[]) TO authenticated;

-- 5. Explicit chat_rooms.is_self_chat column (prevents 1:1 DM where peer left from being misclassified)
ALTER TABLE public.chat_rooms
  ADD COLUMN IF NOT EXISTS is_self_chat boolean NOT NULL DEFAULT false;

UPDATE public.chat_rooms r
   SET is_self_chat = true
 WHERE r.is_self_chat = false
   AND r.is_group = false
   AND r.project_id IS NULL
   AND (
     SELECT COUNT(DISTINCT p.user_id)
     FROM public.chat_participants p
     WHERE p.room_id = r.id
   ) = 1;

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
  WHERE r.is_self_chat = TRUE
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_room_id IS NOT NULL THEN
    RETURN v_room_id;
  END IF;

  INSERT INTO public.chat_rooms (
    name,
    is_group,
    is_self_chat,
    project_id,
    created_by,
    last_message_text,
    last_message_at,
    last_message_sender_id
  ) VALUES (
    '나와의 채팅',
    FALSE,
    TRUE,
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

-- 6. Explicit chat_attachments.storage_object_path column (separates bucket/key from public_url)
ALTER TABLE public.chat_attachments
  ADD COLUMN IF NOT EXISTS storage_object_path text NULL;

UPDATE public.chat_attachments
   SET storage_object_path = NULLIF(
         split_part(
           split_part(COALESCE(public_url, gcs_blob_name, ''), '/storage/v1/object/public/attachments/', 2),
           '?',
           1
         ),
         ''
       )
 WHERE storage_object_path IS NULL
   AND COALESCE(public_url, gcs_blob_name, '') LIKE '%/storage/v1/object/public/attachments/%';

CREATE INDEX IF NOT EXISTS idx_chat_attachments_object_path
  ON public.chat_attachments (storage_object_path)
  WHERE storage_object_path IS NOT NULL;
