CREATE OR REPLACE FUNCTION public.delete_project_announcement(_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  v_project uuid;
  v_created uuid;
BEGIN
  IF v_uid IS NULL OR _announcement_id IS NULL THEN
    RAISE EXCEPTION '삭제할 공지가 없습니다';
  END IF;

  SELECT project_id, created_by INTO v_project, v_created
    FROM public.project_announcements WHERE id = _announcement_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '공지를 찾을 수 없습니다';
  END IF;

  IF NOT public.is_master(v_uid) AND v_created IS DISTINCT FROM v_uid THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.project_members pm
       WHERE pm.project_id = v_project AND pm.user_id = v_uid
         AND COALESCE(pm.role_new::text, '') IN (
           'project_admin','safety_manager','site_manager','supervisor','site_supervisor'
         )
    ) THEN
      RAISE EXCEPTION '삭제 권한이 없습니다';
    END IF;
  END IF;

  DELETE FROM public.notifications
   WHERE related_type = 'announcement'
     AND related_id = _announcement_id::text;

  DELETE FROM public.project_announcements WHERE id = _announcement_id;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

REVOKE ALL ON FUNCTION public.delete_project_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_project_announcement(uuid) TO authenticated, service_role;
