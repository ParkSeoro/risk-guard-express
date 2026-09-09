-- 1) 현장 공지: 사람(관리자/근로자) 구분 없이 해당 범위의 앱 계정 전원.
-- 2) 위평 승인 공지: 대상(또는 작성) 업체만. 시공사 목록은 자사+하위.

ALTER TABLE public.assessment_notices
  ADD COLUMN IF NOT EXISTS company_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

CREATE OR REPLACE FUNCTION public.preview_project_announcement_count(
  _project_id uuid,
  _audience jsonb,
  _author_company_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
STABLE
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
  v_include_desc boolean;
  v_target uuid;
  v_allowed uuid[];
  v_company_ids uuid[];
  v_n int := 0;
BEGIN
  IF v_uid IS NULL OR _project_id IS NULL THEN
    RETURN 0;
  END IF;
  IF NOT v_is_master AND NOT public.is_project_member(v_uid, _project_id) THEN
    RETURN 0;
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

  v_mode := COALESCE(NULLIF(btrim(_audience->>'companyMode'), ''), 'own_tree');
  v_include_desc := COALESCE((_audience->>'includeDescendants')::boolean, true);

  IF v_mode = 'project_all' THEN
    v_company_ids := NULL;
  ELSIF v_mode = 'own_tree' THEN
    IF v_company_id IS NULL THEN
      v_company_ids := CASE WHEN v_is_master THEN NULL ELSE ARRAY[]::uuid[] END;
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
      RETURN 0;
    END IF;
    IF v_mode = 'one_gc' OR v_include_desc THEN
      v_company_ids := public.announcement_company_tree(_project_id, v_target);
    ELSE
      v_company_ids := ARRAY[v_target];
    END IF;
  END IF;

  SELECT count(DISTINCT pm.user_id)::int INTO v_n
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id IS NOT NULL
     AND (v_company_ids IS NULL OR pm.company_id = ANY (v_company_ids) OR pm.user_id = v_uid);

  RETURN COALESCE(v_n, 0);
END;
$body$;

REVOKE ALL ON FUNCTION public.preview_project_announcement_count(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_project_announcement_count(uuid, jsonb, uuid) TO authenticated, service_role;

-- Recipients = every app account in company scope (ignore people=managers/workers).
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
  v_include_desc boolean;
  v_target uuid;
  v_allowed uuid[];
  v_company_ids uuid[];
  v_id uuid;
  v_n int := 0;
  v_pushable int := 0;
  v_link text;
  v_audience jsonb;
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
  v_include_desc := COALESCE((_audience->>'includeDescendants')::boolean, true);
  v_audience := COALESCE(_audience, '{}'::jsonb) || jsonb_build_object('people', 'all');

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
    v_audience, COALESCE(_require_ack, false),
    _expires_at, v_uid
  ) RETURNING id INTO v_id;

  v_link := '/app/worker/today?announcement=' || v_id::text;

  INSERT INTO public.project_announcement_recipients (announcement_id, user_id)
  SELECT DISTINCT v_id, pm.user_id
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id IS NOT NULL
     AND (v_company_ids IS NULL OR pm.company_id = ANY (v_company_ids) OR pm.user_id = v_uid);

  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.project_announcements SET recipient_count = v_n, updated_at = now() WHERE id = v_id;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT r.user_id, _project_id, 'announcement', btrim(_title),
         COALESCE(_body, ''), COALESCE(_body, ''), v_link,
         'announcement', v_id::text,
         NULL,
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

CREATE OR REPLACE FUNCTION public.assessment_notice_copy(_run public.assessment_runs)
RETURNS TABLE (title text, body text, company_ids uuid[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _cos uuid[];
  _co_names text;
  _author text;
  _period text;
  _dates text;
  _summary text;
  _title text;
  _body text;
BEGIN
  _cos := public.assessment_run_effective_company_ids(_run);
  SELECT string_agg(c.name, ', ' ORDER BY c.name)
    INTO _co_names
    FROM public.companies c
   WHERE c.id = ANY (_cos);

  SELECT NULLIF(btrim(p.display_name), '')
    INTO _author
    FROM public.profiles p
   WHERE p.user_id = COALESCE(_run.author_user_id, _run.created_by)
   LIMIT 1;

  _period := COALESCE(NULLIF(btrim(_run.period_label), ''), '위험성평가');
  IF _run.start_date IS NOT NULL AND _run.end_date IS NOT NULL THEN
    _dates := to_char(_run.start_date, 'YYYY-MM-DD') || ' ~ ' || to_char(_run.end_date, 'YYYY-MM-DD');
  ELSIF _run.start_date IS NOT NULL THEN
    _dates := to_char(_run.start_date, 'YYYY-MM-DD');
  ELSE
    _dates := NULL;
  END IF;

  _summary := public.assessment_share_summary(_run.id);
  _title := _period || ' 승인 · ' || COALESCE(NULLIF(_co_names, ''), '대상 업체');
  _body :=
    '업체: ' || COALESCE(NULLIF(_co_names, ''), '(미지정)') || E'\n'
    || COALESCE('기간: ' || _dates || E'\n', '')
    || COALESCE('작성자: ' || _author || E'\n', '')
    || E'\n핵심 위험\n' || _summary
    || E'\n\n내용을 확인하고 서명해 주세요.';

  title := _title;
  body := _body;
  company_ids := COALESCE(_cos, ARRAY[]::uuid[]);
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.assessment_notice_copy(public.assessment_runs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_notice_copy(public.assessment_runs) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_assessment_run_share(_run public.assessment_runs)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _n int := 0;
  _title text;
  _body text;
  _notice_id uuid;
  _share_cos uuid[];
  _copy record;
BEGIN
  IF _run.id IS NULL OR _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN 0;
  END IF;

  SELECT * INTO _copy FROM public.assessment_notice_copy(_run);
  _share_cos := COALESCE(_copy.company_ids, ARRAY[]::uuid[]);
  IF COALESCE(array_length(_share_cos, 1), 0) = 0 THEN
    RETURN 0;
  END IF;
  _title := _copy.title;
  _body := _copy.body;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run.id LIMIT 1;
  IF _notice_id IS NULL THEN
    INSERT INTO public.assessment_notices (
      project_id, run_id, title, body, posted_at, created_by, company_ids
    ) VALUES (
      _run.project_id, _run.id, _title, _body, now(), _run.created_by, _share_cos
    )
    RETURNING id INTO _notice_id;
  ELSE
    UPDATE public.assessment_notices
       SET title = _title,
           body = _body,
           company_ids = _share_cos,
           updated_at = now()
     WHERE id = _notice_id;
  END IF;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT r.user_id, _run.project_id, 'assessment_share', _title, _body, _body,
         '/assessment-run/' || _run.id::text,
         'assessment_run', _run.id::text, 'high', false, now()
    FROM (
      SELECT pm.user_id
        FROM public.project_members pm
        JOIN public.profiles pr ON pr.user_id = pm.user_id
       WHERE pm.project_id = _run.project_id
         AND pm.user_id IS NOT NULL
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _share_cos,
               CASE WHEN pm.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[pm.company_id] END
             )
      UNION
      SELECT pr.user_id
        FROM public.workers w
        JOIN public.profiles pr
          ON public.normalize_phone_digits(COALESCE(pr.phone, '')) <> ''
         AND public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
       WHERE w.project_id = _run.project_id
         AND COALESCE(w.is_active, true) = true
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _share_cos,
               CASE WHEN w.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[w.company_id] END
             )
    ) r
   WHERE r.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = r.user_id
          AND n.type = 'assessment_share'
          AND n.related_id = _run.id::text
          AND n.created_at > now() - interval '1 day'
     );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) TO service_role;

-- Backfill notices for already-approved runs. No extra push.
INSERT INTO public.assessment_notices (
  project_id, run_id, title, body, posted_at, created_by, company_ids
)
SELECT ar.project_id, ar.id, c.title, c.body, now(), ar.created_by, c.company_ids
  FROM public.assessment_runs ar
  CROSS JOIN LATERAL public.assessment_notice_copy(ar) c
 WHERE COALESCE(ar.is_deleted, false) = false
   AND ar.status = '승인완료'
   AND COALESCE(array_length(c.company_ids, 1), 0) > 0
   AND NOT EXISTS (
     SELECT 1 FROM public.assessment_notices n WHERE n.run_id = ar.id
   );

UPDATE public.assessment_notices n
   SET company_ids = c.company_ids,
       title = CASE WHEN n.title LIKE '%승인%' THEN c.title ELSE n.title END,
       body = CASE WHEN n.run_id IS NOT NULL AND (n.body IS NULL OR n.body NOT LIKE '%핵심 위험%') THEN c.body ELSE n.body END,
       updated_at = now()
  FROM public.assessment_runs ar
  CROSS JOIN LATERAL public.assessment_notice_copy(ar) c
 WHERE n.run_id = ar.id
   AND COALESCE(array_length(n.company_ids, 1), 0) = 0
   AND COALESCE(array_length(c.company_ids, 1), 0) > 0;
