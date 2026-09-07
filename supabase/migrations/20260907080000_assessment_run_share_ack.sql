-- Company-scoped RA result sharing on final approval:
-- 1) auto assessment_notices + in-app/push to that company's managers & workers
-- 2) one handwritten share ack per person per run → 근로자 참여 및 공유 서명
-- 3) daily check-in can stamp the same ack once (does not duplicate)

CREATE TABLE IF NOT EXISTS public.assessment_run_share_acks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.assessment_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  worker_name text,
  company_id uuid,
  company_name text,
  signature_data text NOT NULL,
  source text NOT NULL DEFAULT 'notice',
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assessment_run_share_acks_source_chk
    CHECK (source IN ('notice', 'daily_ack', 'viewer')),
  CONSTRAINT assessment_run_share_acks_identity_chk
    CHECK (user_id IS NOT NULL OR worker_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS assessment_run_share_acks_run_user_uidx
  ON public.assessment_run_share_acks (run_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS assessment_run_share_acks_run_worker_uidx
  ON public.assessment_run_share_acks (run_id, worker_id)
  WHERE worker_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS assessment_run_share_acks_run_signed_idx
  ON public.assessment_run_share_acks (run_id, signed_at);

ALTER TABLE public.assessment_run_share_acks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "share_acks_select_members" ON public.assessment_run_share_acks;
CREATE POLICY "share_acks_select_members"
ON public.assessment_run_share_acks
FOR SELECT
TO authenticated
USING (
  public.is_master(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = assessment_run_share_acks.project_id
      AND pm.user_id = auth.uid()
  )
);

GRANT SELECT ON public.assessment_run_share_acks TO authenticated;
GRANT ALL ON public.assessment_run_share_acks TO service_role;

-- Companies this user belongs to on a project (membership + worker roster by phone).
CREATE OR REPLACE FUNCTION public.user_company_ids_for_project(_user_id uuid, _project_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(array_agg(DISTINCT cid), ARRAY[]::uuid[])
  FROM (
    SELECT pm.company_id AS cid
      FROM public.project_members pm
     WHERE pm.user_id = _user_id
       AND pm.project_id = _project_id
       AND pm.company_id IS NOT NULL
    UNION
    SELECT w.company_id
      FROM public.workers w
      JOIN public.profiles p ON p.user_id = _user_id
     WHERE w.project_id = _project_id
       AND COALESCE(w.is_active, true) = true
       AND w.company_id IS NOT NULL
       AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
       AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
  ) s;
$fn$;

REVOKE ALL ON FUNCTION public.user_company_ids_for_project(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_company_ids_for_project(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assessment_run_applies_to_companies(
  _target_company_ids uuid[],
  _user_company_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT
    COALESCE(array_length(_target_company_ids, 1), 0) = 0
    OR EXISTS (
      SELECT 1
        FROM unnest(_target_company_ids) t
       WHERE t = ANY (_user_company_ids)
    );
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_share_summary(_run_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _out text;
BEGIN
  SELECT string_agg(line, E'\n' ORDER BY n)
    INTO _out
    FROM (
      SELECT n,
             format(
               '%s. [%s] %s%s',
               n,
               COALESCE(NULLIF(process, ''), '-'),
               COALESCE(NULLIF(hazard, ''), NULLIF(hazard_situation, ''), '위험'),
               CASE
                 WHEN NULLIF(improvement_measure, '') IS NOT NULL THEN ' → ' || improvement_measure
                 ELSE ''
               END
             ) AS line
        FROM (
          SELECT
            row_number() OVER (
              ORDER BY
                CASE
                  WHEN COALESCE(ri.risk_grade, '') IN ('상', 'high', 'H', '3') THEN 0
                  WHEN COALESCE(ri.risk_grade, '') IN ('중', 'medium', 'M', '2') THEN 1
                  ELSE 2
                END,
                ri.sort_order NULLS LAST
            ) AS n,
            ri.process,
            ri.hazard,
            ri.hazard_situation,
            ri.improvement_measure
          FROM public.risk_items ri
         WHERE ri.run_id = _run_id
           AND COALESCE(ri.is_deleted, false) = false
           AND COALESCE(ri.is_excluded, false) = false
        ) ranked
       WHERE n <= 8
    ) s;
  RETURN COALESCE(NULLIF(btrim(_out), ''), '승인된 위험성평가 요지를 확인해 주세요.');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.list_my_pending_assessment_shares(_project_id uuid DEFAULT NULL)
RETURNS TABLE (
  run_id uuid,
  project_id uuid,
  period_label text,
  type text,
  status text,
  start_date date,
  end_date date,
  summary text,
  notice_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ar.id,
    ar.project_id,
    ar.period_label,
    ar.type,
    ar.status,
    ar.start_date,
    ar.end_date,
    public.assessment_share_summary(ar.id),
    an.id
  FROM public.assessment_runs ar
  LEFT JOIN LATERAL (
    SELECT n.id
      FROM public.assessment_notices n
     WHERE n.run_id = ar.id
     ORDER BY n.posted_at DESC NULLS LAST
     LIMIT 1
  ) an ON true
  WHERE COALESCE(ar.is_deleted, false) = false
    AND ar.status = '승인완료'
    AND (_project_id IS NULL OR ar.project_id = _project_id)
    AND (
      (ar.end_date IS NOT NULL AND ar.end_date >= _today)
      OR (
        ar.end_date IS NULL
        AND COALESCE(ar.start_date, (ar.created_at AT TIME ZONE 'Asia/Seoul')::date)
          >= (_today - 21)
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.user_id = _uid AND pm.project_id = ar.project_id
    )
    AND public.assessment_run_applies_to_companies(
      ar.target_company_ids,
      public.user_company_ids_for_project(_uid, ar.project_id)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.assessment_run_share_acks a
       WHERE a.run_id = ar.id
         AND (
           a.user_id = _uid
           OR (
             a.worker_id IS NOT NULL
             AND a.worker_id IN (
               SELECT w.id FROM public.workers w
               JOIN public.profiles p ON p.user_id = _uid
                WHERE w.project_id = ar.project_id
                  AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
                  AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
             )
           )
         )
    )
  ORDER BY ar.start_date DESC NULLS LAST, ar.created_at DESC;
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_my_pending_assessment_shares(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_pending_assessment_shares(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ack_assessment_run_share(
  _run_id uuid,
  _signature_data text,
  _worker_id uuid DEFAULT NULL,
  _source text DEFAULT 'notice'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _run public.assessment_runs%ROWTYPE;
  _worker public.workers%ROWTYPE;
  _name text;
  _company_id uuid;
  _company_name text;
  _src text;
  _existing uuid;
  _notice_id uuid;
  _user_companies uuid[];
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF _run_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_ARGS');
  END IF;
  IF _signature_data IS NULL OR length(_signature_data) < 80 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATURE_REQUIRED');
  END IF;
  IF _signature_data !~ '^data:image/(png|jpeg|jpg|webp);base64,' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SIGNATURE_INVALID');
  END IF;

  _src := COALESCE(NULLIF(btrim(_source), ''), 'notice');
  IF _src NOT IN ('notice', 'daily_ack', 'viewer') THEN
    _src := 'notice';
  END IF;

  SELECT * INTO _run FROM public.assessment_runs WHERE id = _run_id LIMIT 1;
  IF NOT FOUND OR COALESCE(_run.is_deleted, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RUN_NOT_FOUND');
  END IF;
  IF _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_APPROVED');
  END IF;

  IF NOT public.is_master(_uid) AND NOT EXISTS (
    SELECT 1 FROM public.project_members pm
     WHERE pm.user_id = _uid AND pm.project_id = _run.project_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  _user_companies := public.user_company_ids_for_project(_uid, _run.project_id);
  IF NOT public.is_master(_uid)
     AND NOT public.assessment_run_applies_to_companies(_run.target_company_ids, _user_companies) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WRONG_COMPANY');
  END IF;

  SELECT * INTO _worker
    FROM public.workers
   WHERE _worker_id IS NOT NULL AND id = _worker_id
   LIMIT 1;

  IF _worker.id IS NULL THEN
    SELECT w.* INTO _worker
      FROM public.workers w
      JOIN public.profiles p ON p.user_id = _uid
     WHERE w.project_id = _run.project_id
       AND COALESCE(w.is_active, true) = true
       AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
       AND public.normalize_phone_digits(w.phone) = public.normalize_phone_digits(COALESCE(p.phone, ''))
     LIMIT 1;
  ELSIF _worker.project_id IS DISTINCT FROM _run.project_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WORKER_PROJECT_MISMATCH');
  END IF;

  SELECT a.id INTO _existing
    FROM public.assessment_run_share_acks a
   WHERE a.run_id = _run_id
     AND (
       a.user_id = _uid
       OR (_worker.id IS NOT NULL AND a.worker_id = _worker.id)
     )
   LIMIT 1;
  IF _existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing);
  END IF;

  SELECT COALESCE(NULLIF(display_name, ''), '사용자') INTO _name
    FROM public.profiles WHERE user_id = _uid LIMIT 1;
  IF _worker.id IS NOT NULL THEN
    _name := COALESCE(NULLIF(_worker.name, ''), _name);
    _company_id := _worker.company_id;
    _company_name := NULLIF(_worker.company_name, '');
  END IF;
  IF _company_id IS NULL THEN
    SELECT pm.company_id INTO _company_id
      FROM public.project_members pm
     WHERE pm.user_id = _uid AND pm.project_id = _run.project_id
       AND pm.company_id IS NOT NULL
     LIMIT 1;
  END IF;
  IF _company_name IS NULL AND _company_id IS NOT NULL THEN
    SELECT c.name INTO _company_name FROM public.companies c WHERE c.id = _company_id LIMIT 1;
  END IF;
  IF _company_name IS NULL THEN
    SELECT NULLIF(company, '') INTO _company_name FROM public.profiles WHERE user_id = _uid LIMIT 1;
  END IF;

  BEGIN
    INSERT INTO public.assessment_run_share_acks (
      run_id, project_id, user_id, worker_id, worker_name,
      company_id, company_name, signature_data, source
    ) VALUES (
      _run_id, _run.project_id, _uid, _worker.id, _name,
      _company_id, _company_name, _signature_data, _src
    )
    RETURNING id INTO _existing;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _existing
      FROM public.assessment_run_share_acks
     WHERE run_id = _run_id
       AND (user_id = _uid OR (_worker.id IS NOT NULL AND worker_id = _worker.id))
     LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'already', true, 'id', _existing);
  END;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run_id LIMIT 1;
  IF _notice_id IS NOT NULL AND _worker.id IS NOT NULL THEN
    UPDATE public.assessment_notices
       SET acknowledged_worker_ids = ARRAY(
             SELECT DISTINCT x FROM unnest(
               COALESCE(acknowledged_worker_ids, ARRAY[]::uuid[]) || ARRAY[_worker.id]
             ) AS x
           ),
           updated_at = now()
     WHERE id = _notice_id
       AND NOT (_worker.id = ANY (COALESCE(acknowledged_worker_ids, ARRAY[]::uuid[])));
  END IF;

  RETURN jsonb_build_object('ok', true, 'already', false, 'id', _existing);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ack_assessment_run_share(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_assessment_run_share(uuid, text, uuid, text) TO authenticated, service_role;

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
  _summary text;
BEGIN
  IF _run.id IS NULL OR _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN 0;
  END IF;

  _summary := public.assessment_share_summary(_run.id);
  _title := COALESCE(NULLIF(_run.period_label, ''), '위험성평가') || ' 승인 · 결과 공유';
  _body := COALESCE(NULLIF(_run.period_label, ''), '위험성평가')
        || '가 승인되었습니다. 내용을 확인하고 서명해 주세요.'
        || E'\n\n' || _summary;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run.id LIMIT 1;
  IF _notice_id IS NULL THEN
    INSERT INTO public.assessment_notices (
      project_id, run_id, title, body, posted_at, created_by
    ) VALUES (
      _run.project_id, _run.id, _title, _body, now(), _run.created_by
    )
    RETURNING id INTO _notice_id;
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
               _run.target_company_ids,
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
               _run.target_company_ids,
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

-- Keep permit/TBM operational alerts; add company-wide share fan-out.
CREATE OR REPLACE FUNCTION public.trg_assessment_run_approved_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _target_names text[];
  _item_id uuid;
BEGIN
  IF NEW.status = '승인완료' AND COALESCE(OLD.status, '') <> '승인완료' THEN
    SELECT array_agg(c.name) INTO _target_names
      FROM public.companies c
     WHERE NEW.target_company_ids IS NOT NULL
       AND c.id = ANY(NEW.target_company_ids);

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT wp.created_by, 'assessment_result',
      '위험성평가 승인 - 작업허가서 반영 필요',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/work-permits'
    FROM public.work_permits wp
    WHERE wp.project_id = NEW.project_id
      AND COALESCE(wp.is_deleted, false) = false
      AND wp.status IN ('진행중', '검토중', '대기')
      AND (
        NEW.target_company_ids IS NULL
        OR COALESCE(array_length(NEW.target_company_ids, 1), 0) = 0
        OR (_target_names IS NOT NULL AND wp.contractor_company = ANY(_target_names))
      )
      AND wp.created_by IS NOT NULL;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ts.created_by, 'assessment_result',
      '위험성평가 승인 - TBM 브리핑 반영',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/tbm'
    FROM public.tbm_sessions ts
    WHERE ts.project_id = NEW.project_id
      AND COALESCE(ts.is_deleted, false) = false
      AND ts.is_active = true
      AND (
        NEW.target_company_ids IS NULL
        OR COALESCE(array_length(NEW.target_company_ids, 1), 0) = 0
        OR ts.company_id = ANY(NEW.target_company_ids)
      )
      AND ts.created_by IS NOT NULL;

    BEGIN
      PERFORM public.notify_assessment_run_share(NEW);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_assessment_run_share(%) failed: %', NEW.id, SQLERRM;
    END;

    BEGIN
      PERFORM public.promote_run_to_global_risk_library(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'promote_run_to_global_risk_library(%) failed: %', NEW.id, SQLERRM;
    END;

    IF to_regprocedure('public.ensure_high_risk_item_followup(uuid)') IS NOT NULL THEN
      FOR _item_id IN
        SELECT ri.id
          FROM public.risk_items ri
         WHERE ri.run_id = NEW.id
           AND COALESCE(ri.is_deleted, false) = false
           AND COALESCE(ri.is_excluded, false) = false
           AND public.is_focus_high_risk_item(ri.risk_grade, ri.improved_risk_grade)
      LOOP
        BEGIN
          PERFORM public.ensure_high_risk_item_followup(_item_id);
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'ensure_high_risk_item_followup(%) failed: %', _item_id, SQLERRM;
        END;
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$body$;

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
    'danger_zone_entry','emergency_drill','work_stop','announcement',
    'assessment_share'
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
    WHEN 'assessment_share'    THEN true
    WHEN 'return_request'      THEN COALESCE(p.event_return_request, true)
    WHEN 'validation_complete' THEN COALESCE(p.event_validation_complete, false)
    WHEN 'safety_inspection'   THEN COALESCE(p.event_safety_inspection, true)
    WHEN 'work_permit'         THEN COALESCE(p.event_work_permit, true)
    WHEN 'tbm'                 THEN COALESCE(p.event_tbm, false)
    WHEN 'health_warning'      THEN COALESCE(p.event_health_warning, true)
    WHEN 'health_checkup_due'  THEN COALESCE(p.event_health_checkup_due, true)
    WHEN 'incident'            THEN true
    WHEN 'todo_due'            THEN COALESCE(p.event_todo_due, true)
    WHEN 'assessment_result'   THEN COALESCE(p.event_assessment_result, true)
    ELSE COALESCE(p.event_general, true)
  END;
END;
$function$;
