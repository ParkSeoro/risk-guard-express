CREATE OR REPLACE FUNCTION public.update_project_announcement(
  _announcement_id uuid,
  _title text,
  _body text,
  _require_ack boolean DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL,
  _clear_expires boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  v_project uuid;
  v_created uuid;
  v_withdrawn boolean;
BEGIN
  IF v_uid IS NULL OR _announcement_id IS NULL THEN
    RAISE EXCEPTION '수정할 공지가 없습니다';
  END IF;
  IF btrim(COALESCE(_title, '')) = '' THEN
    RAISE EXCEPTION '제목이 필요합니다';
  END IF;

  SELECT project_id, created_by, is_withdrawn
    INTO v_project, v_created, v_withdrawn
    FROM public.project_announcements WHERE id = _announcement_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '공지를 찾을 수 없습니다';
  END IF;
  IF v_withdrawn THEN
    RAISE EXCEPTION '회수된 공지는 수정할 수 없습니다';
  END IF;

  IF NOT public.is_master(v_uid) AND v_created IS DISTINCT FROM v_uid THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.project_members pm
       WHERE pm.project_id = v_project AND pm.user_id = v_uid
         AND COALESCE(pm.role_new::text, '') IN (
           'project_admin','safety_manager','site_manager','supervisor','site_supervisor'
         )
    ) THEN
      RAISE EXCEPTION '수정 권한이 없습니다';
    END IF;
  END IF;

  UPDATE public.project_announcements
     SET title = btrim(_title),
         body = COALESCE(_body, ''),
         require_ack = COALESCE(_require_ack, require_ack),
         expires_at = CASE
           WHEN _clear_expires THEN NULL
           WHEN _expires_at IS NOT NULL THEN _expires_at
           ELSE expires_at
         END,
         updated_at = now()
   WHERE id = _announcement_id;

  UPDATE public.notifications
     SET title = btrim(_title),
         message = COALESCE(_body, ''),
         body = COALESCE(_body, ''),
         severity = CASE
           WHEN COALESCE(_require_ack, (SELECT require_ack FROM public.project_announcements WHERE id = _announcement_id))
           THEN 'high' ELSE 'medium' END
   WHERE related_type = 'announcement'
     AND related_id = _announcement_id::text;

  RETURN jsonb_build_object('ok', true, 'id', _announcement_id);
END;
$body$;

REVOKE ALL ON FUNCTION public.update_project_announcement(uuid, text, text, boolean, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_announcement(uuid, text, text, boolean, timestamptz, boolean) TO authenticated, service_role;
