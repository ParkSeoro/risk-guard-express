-- Fix announcement push (include author) + edit/delete RPCs.

CREATE OR REPLACE FUNCTION public.publish_project_announcement(
  _project_id uuid,
  _title text,
  _body text,
  _audience jsonb,
  _require_ack boolean DEFAULT false,
  _expires_at timestamptz DEFAULT NULL,
  _author_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
  v_is_master boolean := public.is_master(v_uid);
  v_role text;
  v_company_id uuid;
  v_company_type text;
  v_type_code text;
  v_mode text;
  v_people text;
  v_include_desc boolean;
  v_target uuid;
  v_allowed uuid[];
  v_company_ids uuid[];
  v_id uuid;
  v_n int := 0;
  v_pushable int := 0;
  v_link text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다';
  END IF;
  IF _project_id IS NULL OR btrim(COALESCE(_title, '')) = '' THEN
    RAISE EXCEPTION '제목과 프로젝트가 필요합니다';
  END IF;
  IF NOT v_is_master AND NOT public.is_project_member(v_uid, _project_id) THEN
    RAISE EXCEPTION '이 프로젝트의 공지를 작성할 권한이 없습니다';
  END IF;

  SELECT pm.role_new::text, pm.company_id, c.type
    INTO v_role, v_company_id, v_company_type
    FROM public.project_members pm
    LEFT JOIN public.companies c ON c.id = pm.company_id
   WHERE pm.project_id = _project_id
     AND pm.user_id = v_uid
   ORDER BY CASE COALESCE(pm.role_new::text, '')
     WHEN 'project_admin' THEN 1
     WHEN 'safety_manager' THEN 2
     WHEN 'site_manager' THEN 3
     WHEN 'site_supervisor' THEN 4
     WHEN 'supervisor' THEN 5
     ELSE 9
   END
   LIMIT 1;

  v_company_id := COALESCE(_author_company_id, v_company_id);
  IF v_company_id IS NOT NULL AND v_company_type IS NULL THEN
    SELECT type INTO v_company_type FROM public.companies WHERE id = v_company_id;
  END IF;
  v_type_code := public.announcement_company_type_code(v_company_type);

  IF NOT v_is_master AND COALESCE(v_role, '') NOT IN (
    'project_admin','safety_manager','site_manager','supervisor','site_supervisor'
  ) THEN
    RAISE EXCEPTION '관리자만 공지를 작성할 수 있습니다';
  END IF;

  v_mode := COALESCE(NULLIF(btrim(_audience->>'companyMode'), ''), 'own_tree');
  v_people := COALESCE(NULLIF(btrim(_audience->>'people'), ''), 'all');
  v_include_desc := COALESCE((_audience->>'includeDescendants')::boolean, true);

  IF v_people NOT IN ('managers','workers','all') THEN
    RAISE EXCEPTION '사람 범위가 올바르지 않습니다';
  END IF;

  IF v_type_code IN ('contractor','vendor') AND v_mode NOT IN ('own_tree','one_company') THEN
    RAISE EXCEPTION '협력사는 자사 공지만 보낼 수 있습니다';
  END IF;
  IF v_mode NOT IN ('own_tree','one_gc','one_company','project_all') THEN
    RAISE EXCEPTION '회사 범위가 올바르지 않습니다';
  END IF;

  IF v_mode = 'project_all' THEN
    v_company_ids := NULL;
  ELSIF v_mode = 'own_tree' THEN
    IF v_company_id IS NULL THEN
      IF v_is_master THEN
        v_company_ids := NULL;
      ELSE
        RAISE EXCEPTION '소속 회사가 없어 내 회사 범위를 쓸 수 없습니다';
      END IF;
    ELSE
      v_company_ids := public.announcement_company_tree(_project_id, v_company_id);
    END IF;
  ELSE
    BEGIN
      v_target := NULLIF(btrim(COALESCE(_audience->'companyIds'->>0, '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_target := NULL;
    END;
    IF v_target IS NULL THEN
      RAISE EXCEPTION '회사를 선택하세요';
    END IF;

    IF v_type_code IN ('contractor','vendor') AND v_target IS DISTINCT FROM v_company_id THEN
      RAISE EXCEPTION '협력사는 자사 공지만 보낼 수 있습니다';
    END IF;

    IF v_type_code = 'gc' THEN
      v_allowed := public.announcement_company_tree(_project_id, v_company_id);
      IF NOT (v_target = ANY (v_allowed)) THEN
        RAISE EXCEPTION '다른 시공사에는 공지할 수 없습니다. 현장 전체를 선택하세요';
      END IF;
    END IF;

    IF v_mode = 'one_gc' OR v_include_desc THEN
      v_company_ids := public.announcement_company_tree(_project_id, v_target);
    ELSE
      v_company_ids := ARRAY[v_target];
    END IF;
  END IF;

  INSERT INTO public.project_announcements (
    project_id, author_company_id, title, body, audience, require_ack,
    expires_at, created_by
  ) VALUES (
    _project_id, v_company_id, btrim(_title), COALESCE(_body, ''),
    COALESCE(_audience, '{}'::jsonb), COALESCE(_require_ack, false),
    _expires_at, v_uid
  ) RETURNING id INTO v_id;

  v_link := '/app/worker/today?announcement=' || v_id::text;

  -- Include author so writers also get the phone push (was excluded before).
  INSERT INTO public.project_announcement_recipients (announcement_id, user_id)
  SELECT DISTINCT v_id, pm.user_id
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id IS NOT NULL
     AND (v_company_ids IS NULL OR pm.company_id = ANY (v_company_ids) OR pm.user_id = v_uid)
     AND (
       pm.user_id = v_uid
       OR (v_people = 'all')
       OR (v_people = 'managers' AND COALESCE(pm.role_new::text, '') IN (
            'project_admin','safety_manager','site_manager','supervisor','site_supervisor'
          ))
       OR (v_people = 'workers' AND COALESCE(pm.role_new::text, '') = 'worker')
     );

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.project_announcements SET recipient_count = v_n, updated_at = now() WHERE id = v_id;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT r.user_id, _project_id, 'announcement', btrim(_title),
         COALESCE(_body, ''), COALESCE(_body, ''), v_link,
         'announcement', v_id::text,
         CASE WHEN COALESCE(_require_ack, false) THEN 'high' ELSE 'medium' END,
         false, now()
    FROM public.project_announcement_recipients r
   WHERE r.announcement_id = v_id;

  SELECT count(DISTINCT t.user_id)::int INTO v_pushable
    FROM public.project_announcement_recipients r
    JOIN public.device_push_tokens t ON t.user_id = r.user_id
   WHERE r.announcement_id = v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'recipient_count', v_n,
    'pushable_count', COALESCE(v_pushable, 0)
  );
END;
$body$;

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

  -- Keep inbox rows in sync (no re-push).
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

REVOKE ALL ON FUNCTION public.update_project_announcement(uuid, text, text, boolean, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_project_announcement(uuid, text, text, boolean, timestamptz, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.delete_project_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_project_announcement(uuid) TO authenticated, service_role;
