-- Field announcements (현장 공지). Separate from assessment_notices (RA legal).

CREATE TABLE IF NOT EXISTS public.project_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  require_ack boolean NOT NULL DEFAULT false,
  published_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_withdrawn boolean NOT NULL DEFAULT false,
  withdrawn_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.project_announcement_recipients (
  announcement_id uuid NOT NULL REFERENCES public.project_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.project_announcement_acks (
  announcement_id uuid NOT NULL REFERENCES public.project_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_announcements_project
  ON public.project_announcements (project_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_recipients_user
  ON public.project_announcement_recipients (user_id, announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_acks_user
  ON public.project_announcement_acks (user_id, announcement_id);

ALTER TABLE public.project_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_announcement_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_announcement_acks ENABLE ROW LEVEL SECURITY;

-- Do NOT join recipients/acks from announcements (and vice versa) in RLS —
-- that causes "infinite recursion detected in policy".
DROP POLICY IF EXISTS "announcements_select" ON public.project_announcements;
CREATE POLICY "announcements_select"
  ON public.project_announcements FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

CREATE OR REPLACE FUNCTION public.announcement_project_id(_announcement_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT project_id FROM public.project_announcements WHERE id = _announcement_id;
$$;

REVOKE ALL ON FUNCTION public.announcement_project_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_project_id(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "announcement_recipients_select" ON public.project_announcement_recipients;
CREATE POLICY "announcement_recipients_select"
  ON public.project_announcement_recipients FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), public.announcement_project_id(announcement_id))
  );

DROP POLICY IF EXISTS "announcement_acks_select" ON public.project_announcement_acks;
CREATE POLICY "announcement_acks_select"
  ON public.project_announcement_acks FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), public.announcement_project_id(announcement_id))
  );

GRANT SELECT ON public.project_announcements TO authenticated;
GRANT SELECT ON public.project_announcement_recipients TO authenticated;
GRANT SELECT ON public.project_announcement_acks TO authenticated;
GRANT ALL ON public.project_announcements TO service_role;
GRANT ALL ON public.project_announcement_recipients TO service_role;
GRANT ALL ON public.project_announcement_acks TO service_role;

CREATE OR REPLACE FUNCTION public.announcement_company_type_code(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE lower(btrim(COALESCE(_raw, '')))
    WHEN 'client' THEN 'client'
    WHEN '발주처' THEN 'client'
    WHEN 'owner' THEN 'client'
    WHEN 'gc' THEN 'gc'
    WHEN '시공사' THEN 'gc'
    WHEN '원도급' THEN 'gc'
    WHEN '원청' THEN 'gc'
    WHEN 'general_contractor' THEN 'gc'
    WHEN 'contractor' THEN 'contractor'
    WHEN '협력사' THEN 'contractor'
    WHEN '하청' THEN 'contractor'
    WHEN 'subcontractor' THEN 'contractor'
    WHEN 'vendor' THEN 'vendor'
    WHEN '공급사' THEN 'vendor'
    WHEN '납품사' THEN 'vendor'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.announcement_company_tree(_project_id uuid, _root uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH RECURSIVE walk AS (
    SELECT _root AS company_id
    WHERE _root IS NOT NULL
    UNION
    SELECT pc.company_id
      FROM public.project_companies pc
      JOIN walk w ON pc.parent_company_id = w.company_id
     WHERE pc.project_id = _project_id
       AND COALESCE(pc.is_deleted, false) = false
       AND pc.company_id IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT company_id), ARRAY[]::uuid[]) FROM walk;
$$;

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

  -- Contractor: own company only. GC/client/master: may use 현장 전체.
  IF v_type_code IN ('contractor','vendor') AND v_mode NOT IN ('own_tree','one_company') THEN
    RAISE EXCEPTION '협력사는 자사 공지만 보낼 수 있습니다';
  END IF;
  IF v_mode NOT IN ('own_tree','one_gc','one_company','project_all') THEN
    RAISE EXCEPTION '회사 범위가 올바르지 않습니다';
  END IF;

  IF v_mode = 'project_all' THEN
    v_company_ids := NULL; -- all companies
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

  INSERT INTO public.project_announcement_recipients (announcement_id, user_id)
  SELECT DISTINCT v_id, pm.user_id
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id IS NOT NULL
     AND pm.user_id <> v_uid
     AND (v_company_ids IS NULL OR pm.company_id = ANY (v_company_ids))
     AND (
       (v_people = 'all')
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

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_id,
    'recipient_count', v_n
  );
END;
$body$;

CREATE OR REPLACE FUNCTION public.ack_project_announcement(_announcement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _announcement_id IS NULL THEN
    RAISE EXCEPTION '확인할 공지가 없습니다';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_announcement_recipients
     WHERE announcement_id = _announcement_id AND user_id = v_uid
  ) AND NOT EXISTS (
    SELECT 1 FROM public.project_announcements a
     WHERE a.id = _announcement_id AND a.created_by = v_uid
  ) THEN
    RAISE EXCEPTION '이 공지의 대상이 아닙니다';
  END IF;

  INSERT INTO public.project_announcement_acks (announcement_id, user_id)
  VALUES (_announcement_id, v_uid)
  ON CONFLICT (announcement_id, user_id) DO NOTHING;

  UPDATE public.notifications
     SET is_read = true
   WHERE user_id = v_uid
     AND related_type = 'announcement'
     AND related_id = _announcement_id::text;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

CREATE OR REPLACE FUNCTION public.withdraw_project_announcement(_announcement_id uuid)
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
  SELECT project_id, created_by INTO v_project, v_created
    FROM public.project_announcements WHERE id = _announcement_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION '공지를 찾을 수 없습니다';
  END IF;
  IF NOT (v_created = v_uid OR public.is_master(v_uid) OR public.is_project_member(v_uid, v_project)) THEN
    RAISE EXCEPTION '회수 권한이 없습니다';
  END IF;
  IF NOT public.is_master(v_uid) AND v_created IS DISTINCT FROM v_uid THEN
    -- Only author, master, or same-project admin roles
    IF NOT EXISTS (
      SELECT 1 FROM public.project_members pm
       WHERE pm.project_id = v_project AND pm.user_id = v_uid
         AND COALESCE(pm.role_new::text, '') IN (
           'project_admin','safety_manager','site_manager','supervisor','site_supervisor'
         )
    ) THEN
      RAISE EXCEPTION '회수 권한이 없습니다';
    END IF;
  END IF;

  UPDATE public.project_announcements
     SET is_withdrawn = true, withdrawn_at = now(), updated_at = now()
   WHERE id = _announcement_id;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

CREATE OR REPLACE FUNCTION public.list_my_pending_announcements(_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid,
  project_id uuid,
  title text,
  body text,
  require_ack boolean,
  published_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.id, a.project_id, a.title, a.body, a.require_ack, a.published_at, a.expires_at
    FROM public.project_announcements a
    JOIN public.project_announcement_recipients r
      ON r.announcement_id = a.id AND r.user_id = auth.uid()
   WHERE a.is_withdrawn = false
     AND (_project_id IS NULL OR a.project_id = _project_id)
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND NOT EXISTS (
       SELECT 1 FROM public.project_announcement_acks k
        WHERE k.announcement_id = a.id AND k.user_id = auth.uid()
     )
   ORDER BY a.require_ack DESC, a.published_at DESC;
$$;

REVOKE ALL ON FUNCTION public.announcement_company_type_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_company_type_code(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.announcement_company_tree(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.announcement_company_tree(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.publish_project_announcement(uuid, text, text, jsonb, boolean, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_project_announcement(uuid, text, text, jsonb, boolean, timestamptz, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ack_project_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_project_announcement(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.withdraw_project_announcement(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_project_announcement(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_my_pending_announcements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_announcements(uuid) TO authenticated, service_role;

-- Mandatory push for 현장 공지 (installed-app users always get it).
CREATE OR REPLACE FUNCTION public.should_push_notify(_user_id uuid, _type text)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  p record;
  _is_mandatory boolean;
  _now_t time := (now() AT TIME ZONE 'Asia/Seoul')::time;
BEGIN
  _is_mandatory := _type IN (
    'incident','approval_request','approval_result','critical_alert',
    'danger_zone_entry','emergency_drill','work_stop','announcement'
  );

  SELECT * INTO p FROM public.notification_preferences WHERE user_id = _user_id;
  IF p IS NULL THEN RETURN true; END IF;
  IF NOT _is_mandatory AND COALESCE(p.channel_push, true) = false THEN RETURN false; END IF;

  IF NOT _is_mandatory AND p.push_quiet_start IS NOT NULL AND p.push_quiet_end IS NOT NULL THEN
    IF p.push_quiet_start < p.push_quiet_end THEN
      IF _now_t >= p.push_quiet_start AND _now_t < p.push_quiet_end THEN RETURN false; END IF;
    ELSE
      IF _now_t >= p.push_quiet_start OR _now_t < p.push_quiet_end THEN RETURN false; END IF;
    END IF;
  END IF;

  RETURN CASE _type
    WHEN 'approval_request'    THEN true
    WHEN 'approval_result'     THEN true
    WHEN 'danger_zone_entry'   THEN true
    WHEN 'announcement'        THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, false)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;
