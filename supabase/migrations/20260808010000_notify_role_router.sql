-- Role-based notification router (create-time SSOT).
-- Use notify_masters / notify_project_roles instead of ad-hoc project_members fan-out.

CREATE OR REPLACE FUNCTION public.notify_masters(
  _title text,
  _message text,
  _type text DEFAULT 'warning',
  _link text DEFAULT NULL,
  _project_id uuid DEFAULT NULL,
  _related_type text DEFAULT NULL,
  _related_id text DEFAULT NULL,
  _severity text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _n int := 0;
BEGIN
  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT ur.user_id, _project_id, COALESCE(NULLIF(_type, ''), 'warning'),
         _title, COALESCE(_message, ''), COALESCE(_message, ''), _link,
         _related_type, _related_id, _severity, false, now()
    FROM public.user_roles ur
   WHERE ur.role = 'master'::public.global_role
     AND ur.user_id IS NOT NULL;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$body$;

CREATE OR REPLACE FUNCTION public.notify_project_roles(
  _project_id uuid,
  _roles text[] DEFAULT ARRAY['project_admin','safety_manager','site_manager'],
  _title text DEFAULT '',
  _message text DEFAULT '',
  _type text DEFAULT 'task_assigned',
  _link text DEFAULT NULL,
  _company_id uuid DEFAULT NULL,
  _exclude_user_id uuid DEFAULT NULL,
  _related_type text DEFAULT NULL,
  _related_id text DEFAULT NULL,
  _severity text DEFAULT NULL,
  _positions text[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _n int := 0;
BEGIN
  IF _project_id IS NULL OR COALESCE(array_length(_roles, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT pm.user_id, _project_id, COALESCE(NULLIF(_type, ''), 'task_assigned'),
         _title, COALESCE(_message, ''), COALESCE(_message, ''), _link,
         _related_type, _related_id, _severity, false, now()
    FROM public.project_members pm
   WHERE pm.project_id = _project_id
     AND pm.user_id IS NOT NULL
     AND (_exclude_user_id IS NULL OR pm.user_id <> _exclude_user_id)
     AND (_company_id IS NULL OR pm.company_id = _company_id)
     AND (
       COALESCE(pm.role_new::text, '') = ANY (_roles)
       OR (
         _positions IS NOT NULL
         AND COALESCE(array_length(_positions, 1), 0) > 0
         AND COALESCE(pm.position_new::text, '') = ANY (_positions)
       )
     )
     -- Never notify plain workers/viewers via this helper
     AND COALESCE(pm.role_new::text, '') NOT IN ('worker', 'viewer');

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$body$;

REVOKE ALL ON FUNCTION public.notify_masters(text, text, text, text, uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_masters(text, text, text, text, uuid, text, text, text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.notify_project_roles(uuid, text[], text, text, text, text, uuid, uuid, text, text, text, text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_project_roles(uuid, text[], text, text, text, text, uuid, uuid, text, text, text, text[])
  TO authenticated, service_role;

-- Daily consistency audit → masters only via router
CREATE OR REPLACE FUNCTION public.run_daily_consistency_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  v_report jsonb;
  v_issue_count int := 0;
  v_summary text;
  v_n int := 0;
BEGIN
  v_report := public.audit_data_consistency();
  v_issue_count := COALESCE((v_report->>'total_issues')::int, 0);

  IF v_issue_count = 0 THEN
    RETURN jsonb_build_object('ok', true, 'issues', 0, 'ran_at', now(), 'report', v_report);
  END IF;

  v_summary := format(
    '데이터 정합성 검사에서 %s건의 이슈가 감지되었습니다. /admin/data-audit 에서 확인하세요.',
    v_issue_count
  );

  v_n := public.notify_masters(
    '데이터 정합성 경고',
    v_summary,
    'warning',
    '/admin/data-audit',
    NULL,
    'data_audit',
    NULL,
    'medium'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'issues', v_issue_count,
    'notified_masters', v_n,
    'ran_at', now(),
    'report', v_report
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.run_daily_consistency_audit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_daily_consistency_audit() TO service_role;

-- Work-stop: include safety leadership roles
CREATE OR REPLACE FUNCTION public.fn_work_stop_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  PERFORM public.notify_project_roles(
    NEW.project_id,
    ARRAY['project_admin', 'safety_manager', 'site_manager'],
    '작업중지 요청 접수',
    COALESCE(NEW.hazard_description, '위험상황'),
    'work_stop_request',
    '/work-stop/' || NEW.id::text,
    NULL,
    NULL,
    'work_stop_request',
    NEW.id::text,
    'critical',
    ARRAY['SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM']
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$body$;

-- Zone entry: keep intruder self-alert; admin fan-out via router (roles + positions)
CREATE OR REPLACE FUNCTION public.trg_zone_event_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  z record;
  rz record;
  worker_uid uuid;
  display_name text;
  role_label text;
  pm_role text;
  pm_pos text;
  zone_label text;
  zone_name text;
  link_url text;
  subject_phrase text;
BEGIN
  IF NEW.event_type <> 'unauthorized_entry' THEN
    RETURN NEW;
  END IF;

  zone_label := '위험구역';
  zone_name := '위험구역';

  IF NEW.zone_id IS NOT NULL THEN
    SELECT id, name, zone_type INTO z
      FROM public.site_zones WHERE id = NEW.zone_id;
    IF FOUND THEN
      zone_label := CASE COALESCE(z.zone_type, 'danger')
                      WHEN 'restricted' THEN '제한구역' ELSE '위험구역' END;
      zone_name := COALESCE(z.name, zone_name);
    END IF;
  END IF;

  IF NEW.restricted_zone_id IS NOT NULL THEN
    SELECT id, name INTO rz FROM public.restricted_zones WHERE id = NEW.restricted_zone_id;
    IF FOUND THEN
      zone_label := '위험구역';
      zone_name := COALESCE(rz.name, zone_name);
    END IF;
  END IF;

  link_url := '/zone-events?project=' || NEW.project_id::text;
  display_name := COALESCE(NULLIF(btrim(NEW.worker_name), ''), '미확인');

  role_label := NULL;
  IF NEW.notes IS NOT NULL AND NEW.notes ~ 'role_label=' THEN
    role_label := NULLIF(btrim(substring(NEW.notes from 'role_label=([^|]+)')), '');
  END IF;

  worker_uid := NULL;
  IF NEW.worker_phone IS NOT NULL AND NEW.worker_phone <> '' THEN
    SELECT user_id INTO worker_uid FROM public.profiles
     WHERE phone = NEW.worker_phone LIMIT 1;
  END IF;
  IF worker_uid IS NULL AND NEW.worker_qr_id IS NOT NULL THEN
    SELECT p.user_id INTO worker_uid
      FROM public.workers w
      JOIN public.profiles p ON p.phone = w.phone
     WHERE w.id = NEW.worker_qr_id LIMIT 1;
  END IF;
  IF worker_uid IS NULL AND NEW.worker_name IS NOT NULL AND btrim(NEW.worker_name) <> '' THEN
    SELECT p.user_id INTO worker_uid
      FROM public.profiles p
      JOIN public.project_members pm ON pm.user_id = p.user_id
     WHERE p.display_name = btrim(NEW.worker_name)
       AND pm.project_id = NEW.project_id
     LIMIT 1;
  END IF;

  IF role_label IS NULL AND worker_uid IS NOT NULL THEN
    SELECT COALESCE(pm.role_new::text, ''), COALESCE(pm.position_new::text, '')
      INTO pm_role, pm_pos
      FROM public.project_members pm
     WHERE pm.project_id = NEW.project_id
       AND pm.user_id = worker_uid
     LIMIT 1;

    IF NOT FOUND THEN
      IF public.is_master(worker_uid) THEN
        role_label := '관리자님';
      END IF;
    ELSE
      role_label := CASE lower(pm_role)
        WHEN 'master' THEN '관리자님'
        WHEN 'project_admin' THEN '관리자님'
        WHEN 'safety_manager' THEN '안전관리자님'
        WHEN 'site_manager' THEN '현장소장님'
        WHEN 'supervisor' THEN '감리님'
        WHEN 'site_supervisor' THEN '관리감독자님'
        WHEN 'viewer' THEN '열람자'
        WHEN 'worker' THEN '근로자'
        ELSE NULL
      END;
      IF role_label IS NULL THEN
        role_label := CASE upper(pm_pos)
          WHEN 'OWNER_PM' THEN '관리자님'
          WHEN 'OWNER_CM' THEN '관리자님'
          WHEN 'CEO' THEN '관리자님'
          WHEN 'EXECUTIVE' THEN '관리자님'
          WHEN 'OWNER_SM' THEN '안전관리자님'
          WHEN 'OWNER_HSE' THEN '안전관리자님'
          WHEN 'HSE_MANAGER' THEN '안전관리자님'
          WHEN 'SITE_MANAGER' THEN '현장소장님'
          WHEN 'SUPERVISOR' THEN '감리님'
          WHEN 'SITE_SUPERVISOR' THEN '관리감독자님'
          WHEN 'WORKER' THEN '근로자'
          ELSE '담당자'
        END;
      END IF;
    END IF;
  END IF;

  IF role_label IS NULL OR btrim(role_label) = '' THEN
    role_label := '담당자';
  END IF;

  subject_phrase := display_name || ' ' || role_label;

  IF worker_uid IS NOT NULL THEN
    INSERT INTO public.notifications
      (user_id, project_id, type, title, message, body, related_type, related_id,
       link, severity, is_read)
    VALUES
      (worker_uid, NEW.project_id, 'danger_zone_entry',
       zone_label || ' 진입 경고',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       zone_name || '에 진입했습니다. 즉시 이탈하십시오.',
       'zone_event', NEW.id::text, link_url, 'high', false);
  END IF;

  PERFORM public.notify_project_roles(
    NEW.project_id,
    ARRAY['project_admin', 'safety_manager', 'site_manager'],
    '긴급: ' || subject_phrase || ' 위험 구역 진입',
    subject_phrase || '이(가) ' || zone_name || '에 진입했습니다. 즉시 확인하세요.',
    'danger_zone_entry',
    link_url,
    NULL,
    worker_uid,
    'zone_event',
    NEW.id::text,
    'high',
    ARRAY['SITE_MANAGER', 'HSE_MANAGER', 'OWNER_HSE', 'OWNER_SM', 'SUPERVISOR']
  );

  RETURN NEW;
END;
$body$;
