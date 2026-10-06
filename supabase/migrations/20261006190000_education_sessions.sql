-- Site education is a session: one class, many workers, worker signatures, manager photos.
-- The per-person ledger is written when the session closes, and only enough hours close the duty.
-- Construction basic safety stays a certificate check. Daily workers do not get regular-education duties.

-- English mapping codes must be storable next to the older Korean ledger labels.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'worker_education_records'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%education_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.worker_education_records DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.education_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id),
  education_type text NOT NULL CHECK (education_type IN ('regular','new_hire','job_change','special','manager','msds')),
  course_name text NOT NULL,
  hours numeric(5,2) NOT NULL CHECK (hours > 0),
  held_on date NOT NULL,
  instructor text,
  place text,
  outline text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  photo_urls text[] NOT NULL DEFAULT '{}',
  created_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.education_session_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.education_sessions(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL REFERENCES public.workers(id) ON DELETE CASCADE,
  signature_data text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, worker_id)
);

ALTER TABLE public.worker_education_records
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.education_sessions(id);

CREATE UNIQUE INDEX IF NOT EXISTS worker_education_records_session_worker
  ON public.worker_education_records (session_id, worker_id)
  WHERE session_id IS NOT NULL AND is_deleted = false;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.education_session_attendees TO authenticated;
GRANT ALL ON public.education_sessions TO service_role;
GRANT ALL ON public.education_session_attendees TO service_role;

ALTER TABLE public.education_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_session_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS education_sessions_member ON public.education_sessions;
CREATE POLICY education_sessions_member ON public.education_sessions
  FOR ALL TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()))
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS education_session_attendees_member ON public.education_session_attendees;
CREATE POLICY education_session_attendees_member ON public.education_session_attendees
  FOR ALL TO authenticated
  USING (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()))
  WITH CHECK (public.is_project_member(auth.uid(), project_id) OR public.is_master(auth.uid()));

-- Half-year (regular) or calendar year (manager). Other types are cumulative.
CREATE OR REPLACE FUNCTION public.education_hour_window(_subtype text, _on date)
RETURNS TABLE (start_on date, end_on date)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN _subtype = 'regular' AND EXTRACT(MONTH FROM _on) <= 6
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 1, 1)
      WHEN _subtype = 'regular'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 7, 1)
      WHEN _subtype = 'manager'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 1, 1)
      ELSE NULL
    END,
    CASE
      WHEN _subtype = 'regular' AND EXTRACT(MONTH FROM _on) <= 6
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 6, 30)
      WHEN _subtype = 'regular'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 12, 31)
      WHEN _subtype = 'manager'
        THEN make_date(EXTRACT(YEAR FROM _on)::int, 12, 31)
      ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION public.education_period_hours(_worker_id uuid, _subtype text, _on date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.hours), 0)
  FROM public.worker_education_records r
  CROSS JOIN public.education_hour_window(_subtype, COALESCE(_on, CURRENT_DATE)) w
  WHERE r.worker_id = _worker_id
    AND COALESCE(r.is_deleted, false) = false
    AND public.education_record_requirement_subtype(r.education_type) = _subtype
    AND (
      w.start_on IS NULL
      OR (r.completed_at >= w.start_on AND r.completed_at <= w.end_on)
    );
$$;

CREATE OR REPLACE FUNCTION public.education_required_hours(_worker_id uuid, _subtype text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.required_hours
  FROM public.workers w
  JOIN public.worker_legal_education_mapping m
    ON m.education_type = _subtype
   AND COALESCE(m.is_deleted, false) = false
   AND (
     m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
     OR m.job_type = 'all'
   )
   AND (m.is_system_default = true OR m.project_id = w.project_id)
  WHERE w.id = _worker_id
  ORDER BY (m.project_id IS NOT NULL) DESC, m.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.education_hours_met(_worker_id uuid, _subtype text, _on date)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _need numeric;
  _have numeric;
BEGIN
  IF _worker_id IS NULL OR _subtype IS NULL THEN
    RETURN false;
  END IF;

  -- A construction basic-safety certificate replaces daily hire education.
  IF _subtype = 'new_hire' AND EXISTS (
    SELECT 1 FROM public.worker_education_records r
    WHERE r.worker_id = _worker_id
      AND COALESCE(r.is_deleted, false) = false
      AND public.education_record_requirement_subtype(r.education_type) = 'new_hire_construction'
  ) THEN
    RETURN true;
  END IF;

  _need := public.education_required_hours(_worker_id, _subtype);
  IF _need IS NULL THEN
    RETURN false;
  END IF;
  _have := public.education_period_hours(_worker_id, _subtype, COALESCE(_on, CURRENT_DATE));
  RETURN _have >= _need;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_worker_education_record_complete_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _subtype text;
BEGIN
  _subtype := public.education_record_requirement_subtype(NEW.education_type);
  IF NEW.worker_id IS NULL OR _subtype IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;
  IF NOT public.education_hours_met(NEW.worker_id, _subtype, NEW.completed_at) THEN
    RETURN NEW;
  END IF;

  UPDATE public.worker_required_items
     SET status = 'done',
         completed_at = now(),
         completed_ref_id = NEW.id,
         updated_at = now()
   WHERE worker_id = NEW.worker_id
     AND item_type = 'education'
     AND subtype = _subtype
     AND status IN ('pending', 'overdue')
     AND COALESCE(is_deleted, false) = false;

  IF _subtype = 'new_hire_construction' THEN
    UPDATE public.worker_required_items
       SET status = 'done',
           completed_at = now(),
           completed_ref_id = NEW.id,
           updated_at = now()
     WHERE worker_id = NEW.worker_id
       AND item_type = 'education'
       AND subtype = 'new_hire'
       AND status IN ('pending', 'overdue')
       AND COALESCE(is_deleted, false) = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_education_session_write_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'closed' OR OLD.status = 'closed' THEN
    RETURN NEW;
  END IF;

  NEW.closed_at := COALESCE(NEW.closed_at, now());

  INSERT INTO public.worker_education_records (
    project_id, worker_id, company_id, education_type, course_name, hours,
    completed_at, instructor, notes, created_by, session_id
  )
  SELECT
    NEW.project_id,
    a.worker_id,
    w.company_id,
    NEW.education_type,
    NEW.course_name,
    NEW.hours,
    NEW.held_on,
    NULLIF(btrim(COALESCE(NEW.instructor, '')), ''),
    'education_session',
    COALESCE(auth.uid(), NEW.created_by),
    NEW.id
  FROM public.education_session_attendees a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.session_id = NEW.id
    AND length(btrim(COALESCE(a.signature_data, ''))) >= 80
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_education_records r
      WHERE r.session_id = NEW.id
        AND r.worker_id = a.worker_id
        AND COALESCE(r.is_deleted, false) = false
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_education_session_write_ledger ON public.education_sessions;
CREATE TRIGGER trg_education_session_write_ledger
  BEFORE UPDATE OF status ON public.education_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_education_session_write_ledger();

CREATE OR REPLACE FUNCTION public.sign_education_session(_session_id uuid, _signature text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
  _session public.education_sessions%ROWTYPE;
  _worker_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;
  IF _signature IS NULL OR length(_signature) < 80 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;

  SELECT * INTO _session FROM public.education_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;
  IF _session.status <> 'open' THEN
    RETURN jsonb_build_object('error', 'SESSION_CLOSED');
  END IF;

  SELECT public.normalize_phone_digits(p.phone) INTO _phone
  FROM public.profiles p
  WHERE p.user_id = _uid
  LIMIT 1;

  IF COALESCE(_phone, '') = '' THEN
    RETURN jsonb_build_object('error', 'NO_WORKER');
  END IF;

  SELECT a.worker_id INTO _worker_id
  FROM public.education_session_attendees a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.session_id = _session_id
    AND public.normalize_phone_digits(w.phone) = _phone
  LIMIT 1;

  IF _worker_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_INVITED');
  END IF;

  UPDATE public.education_session_attendees
     SET signature_data = _signature,
         signed_at = now()
   WHERE session_id = _session_id
     AND worker_id = _worker_id;

  RETURN jsonb_build_object('success', true, 'worker_id', _worker_id);
END;
$$;

REVOKE ALL ON FUNCTION public.education_hour_window(text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_period_hours(uuid, text, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_required_hours(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.education_hours_met(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_hours_met(uuid, text, date) TO service_role;

REVOKE ALL ON FUNCTION public.sign_education_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_education_session(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_my_open_education_sessions()
RETURNS TABLE (
  session_id uuid,
  course_name text,
  education_type text,
  held_on date,
  hours numeric,
  place text,
  outline text,
  instructor text,
  signed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;
  SELECT public.normalize_phone_digits(p.phone) INTO _phone
  FROM public.profiles p WHERE p.user_id = _uid LIMIT 1;
  IF COALESCE(_phone, '') = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.id, s.course_name, s.education_type, s.held_on, s.hours, s.place, s.outline, s.instructor,
         length(btrim(COALESCE(a.signature_data, ''))) >= 80
  FROM public.education_session_attendees a
  JOIN public.education_sessions s ON s.id = a.session_id
  JOIN public.workers w ON w.id = a.worker_id
  WHERE s.status = 'open'
    AND public.normalize_phone_digits(w.phone) = _phone;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_open_education_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_open_education_sessions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_education_shortfall(_project_id uuid, _education_type text)
RETURNS TABLE (worker_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_project_member(auth.uid(), _project_id)
     AND NOT public.is_master(auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT w.id
  FROM public.workers w
  WHERE w.project_id = _project_id
    AND COALESCE(w.is_active, true) = true
    AND EXISTS (
      SELECT 1 FROM public.worker_legal_education_mapping m
      WHERE COALESCE(m.is_deleted, false) = false
        AND m.education_type = _education_type
        AND (
          m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
          OR m.job_type = 'all'
        )
        AND (m.is_system_default = true OR m.project_id = w.project_id)
    )
    AND NOT public.education_hours_met(w.id, _education_type, CURRENT_DATE);
END;
$$;

REVOKE ALL ON FUNCTION public.list_education_shortfall(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_education_shortfall(uuid, text) TO authenticated, service_role;

-- Status follows hours in the legal window, not a single ledger row.
CREATE OR REPLACE FUNCTION public.compute_worker_required_education(_worker_id uuid)
RETURNS TABLE (
  job_type text,
  education_type text,
  required_hours numeric,
  interval_months int,
  first_due_days int,
  legal_basis text,
  next_due_at date,
  last_completed_at date,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
  _today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
BEGIN
  SELECT id, project_id, workers.job_type, hire_date INTO w
  FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH mapping AS (
    SELECT DISTINCT ON (m.education_type)
      m.job_type, m.education_type, m.required_hours, m.interval_months,
      m.first_due_days, m.legal_basis
    FROM public.worker_legal_education_mapping m
    WHERE COALESCE(m.is_deleted, false) = false
      AND (
        m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
        OR m.job_type = 'all'
      )
      AND (m.is_system_default = true OR m.project_id = w.project_id)
    ORDER BY m.education_type, (m.project_id = w.project_id) DESC
  ),
  latest AS (
    SELECT public.education_record_requirement_subtype(r.education_type) AS education_type,
           MAX(r.completed_at) AS last_completed_at
    FROM public.worker_education_records r
    WHERE r.worker_id = _worker_id AND COALESCE(r.is_deleted, false) = false
    GROUP BY 1
  ),
  bounds AS (
    SELECT mp.education_type, win.end_on
    FROM mapping mp
    LEFT JOIN LATERAL public.education_hour_window(mp.education_type, _today) win ON true
  )
  SELECT
    mp.job_type, mp.education_type, mp.required_hours, mp.interval_months,
    mp.first_due_days, mp.legal_basis,
    CASE
      WHEN mp.education_type IN ('regular', 'manager') THEN b.end_on
      WHEN public.education_hours_met(_worker_id, mp.education_type, _today) THEN NULL
      ELSE (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date
    END AS next_due_at,
    l.last_completed_at,
    CASE
      WHEN public.education_hours_met(_worker_id, mp.education_type, _today) THEN 'ok'
      WHEN mp.education_type = 'regular' AND b.end_on IS NOT NULL AND (b.end_on - _today) <= 30 THEN 'due_soon'
      WHEN mp.education_type = 'manager' AND b.end_on IS NOT NULL AND (b.end_on - _today) <= 30 THEN 'due_soon'
      WHEN COALESCE(mp.interval_months, 0) = 0
           AND (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date < _today
        THEN 'overdue'
      WHEN COALESCE(mp.interval_months, 0) > 0
           AND (COALESCE(w.hire_date, _today) + (mp.first_due_days || ' days')::interval)::date < _today
        THEN 'overdue'
      ELSE 'missing'
    END AS status
  FROM mapping mp
  LEFT JOIN latest l ON l.education_type = mp.education_type
  LEFT JOIN bounds b ON b.education_type = mp.education_type;
END;
$$;

-- Resolve Korean trade names before seeding, and do not copy daily regular education onto every trade.
CREATE OR REPLACE FUNCTION public.generate_worker_required_items(_worker_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _w record;
  _m record;
  _base date;
  _due date;
  _count int := 0;
  _job text;
  _has_hazardous boolean;
BEGIN
  SELECT * INTO _w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND OR COALESCE(_w.is_active, true) = false THEN RETURN 0; END IF;

  _job := public.resolve_legal_education_job_type(COALESCE(_w.job_type, 'general'));
  _has_hazardous := array_length(COALESCE(_w.assigned_chemicals, ARRAY[]::uuid[]), 1) > 0;
  _base := COALESCE(_w.hire_date, CURRENT_DATE);

  FOR _m IN
    WITH ranked AS (
      SELECT m.*,
        ROW_NUMBER() OVER (
          PARTITION BY m.job_type, m.education_type
          ORDER BY (m.project_id IS NOT NULL) DESC, m.updated_at DESC
        ) AS rn
      FROM public.worker_legal_education_mapping m
      WHERE COALESCE(m.is_deleted, false) = false
        AND (m.project_id IS NULL OR m.project_id = _w.project_id)
        AND (
          m.job_type = _job
          OR (_has_hazardous AND m.job_type IN ('hazardous','chemical'))
          OR (
            m.job_type = 'general'
            AND _job NOT IN ('office','manager','safety_officer','construction_perm')
            AND m.education_type <> 'regular'
          )
        )
    )
    SELECT * FROM ranked WHERE rn = 1
  LOOP
    _due := _base + COALESCE(_m.first_due_days, 0);

    IF EXISTS (
      SELECT 1 FROM public.worker_required_items
      WHERE worker_id = _worker_id
        AND item_type = CASE WHEN _m.education_type LIKE '%health' OR _m.education_type LIKE '%_health' THEN 'checkup' ELSE 'education' END
        AND subtype = _m.education_type
        AND status = 'pending'
        AND COALESCE(is_deleted, false) = false
    ) THEN CONTINUE; END IF;

    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (
      _worker_id, _w.project_id,
      CASE WHEN _m.education_type LIKE '%health' THEN 'checkup' ELSE 'education' END,
      _m.education_type, _due, 'pending', 'auto', _m.legal_basis
    );
    _count := _count + 1;
  END LOOP;

  IF _w.requires_daily_health_log AND NOT EXISTS (
    SELECT 1 FROM public.worker_required_items
    WHERE worker_id = _worker_id AND item_type = 'daily_log' AND status = 'pending'
      AND due_date = CURRENT_DATE AND COALESCE(is_deleted, false) = false
  ) THEN
    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (_worker_id, _w.project_id, 'daily_log',
      CASE WHEN COALESCE(_w.health_grade, '') IN ('D1','D2')
              OR COALESCE(_w.health_checkup_status::text, '') IN ('유소견D1','유소견D2')
           THEN 'health_d' ELSE 'age65' END,
      CURRENT_DATE, 'pending', 'auto',
      '산업안전보건법 제129조 / 고령자 건강관리 지침');
    _count := _count + 1;
  END IF;

  RETURN _count;
END; $function$;

-- 별표 4 (2025. 5. 30.): 정기교육은 반기. 일용은 정기교육 대상이 아니다.
UPDATE public.worker_legal_education_mapping
   SET required_hours = 6,
       interval_months = 6,
       first_due_days = 180,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 사무직 반기 6시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'office' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET is_deleted = true, updated_at = now()
 WHERE is_system_default = true AND job_type = 'general' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 12,
       interval_months = 6,
       first_due_days = 180,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 상시근로자 반기 12시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'construction_perm' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 8,
       first_due_days = 1,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 채용 시 교육 8시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'office' AND education_type = 'new_hire';

UPDATE public.worker_legal_education_mapping
   SET is_deleted = true, updated_at = now()
 WHERE is_system_default = true AND job_type = 'short_term' AND education_type = 'new_hire';

UPDATE public.worker_legal_education_mapping
   SET is_deleted = true, updated_at = now()
 WHERE is_system_default = true AND job_type = 'safety_officer' AND education_type = 'manager';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 16,
       interval_months = 12,
       first_due_days = 365,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 관리감독자 연 16시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'manager' AND education_type = 'manager';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 1,
       interval_months = 0,
       first_due_days = 1,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 일용 채용 시 교육 1시간. 기초안전 이수증이 있으면 면제',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'general' AND education_type = 'new_hire';

UPDATE public.worker_legal_education_mapping
   SET is_deleted = true, updated_at = now()
 WHERE is_system_default = true AND job_type = 'construction_perm' AND education_type = 'new_hire_construction';

INSERT INTO public.worker_legal_education_mapping
  (project_id, job_type, education_type, interval_months, first_due_days, required_hours, legal_basis, is_system_default, is_deleted)
SELECT NULL, 'construction_perm', 'new_hire', 0, 1, 8,
       '산업안전보건법 시행규칙 제26조 [별표4] - 상시 채용 시 교육 8시간', true, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.worker_legal_education_mapping
  WHERE is_system_default = true AND job_type = 'construction_perm' AND education_type = 'new_hire' AND is_deleted = false
);

UPDATE public.worker_legal_education_mapping
   SET required_hours = 2,
       interval_months = 0,
       first_due_days = 1,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 일용·단기간·간헐 특별교육 2시간. 상시 16시간은 회차 시간으로 나눈다',
       updated_at = now()
 WHERE is_system_default = true AND education_type = 'special';

-- Drop pending regular duties from daily trades, and the mistaken safety-officer class duty.
DELETE FROM public.worker_required_items i
USING public.workers w
WHERE i.worker_id = w.id
  AND i.item_type = 'education'
  AND i.subtype = 'regular'
  AND i.status IN ('pending', 'overdue')
  AND i.completed_at IS NULL
  AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
      NOT IN ('office', 'construction_perm');

DELETE FROM public.worker_required_items i
USING public.workers w
WHERE i.worker_id = w.id
  AND i.item_type = 'education'
  AND i.subtype = 'manager'
  AND i.status IN ('pending', 'overdue')
  AND i.completed_at IS NULL
  AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general')) = 'safety_officer';

DELETE FROM public.worker_required_items i
USING public.workers w
WHERE i.worker_id = w.id
  AND i.item_type = 'education'
  AND i.subtype = 'new_hire'
  AND i.status IN ('pending', 'overdue')
  AND i.completed_at IS NULL
  AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general')) = 'short_term';

-- One line per site: regular shortfall near the half end, missing certificates today, checkups due.
CREATE OR REPLACE FUNCTION public.education_obligation_digest(_today date DEFAULT NULL)
RETURNS TABLE (project_id uuid, kind text, headcount int, message text, link text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _day date := COALESCE(_today, (now() AT TIME ZONE 'Asia/Seoul')::date);
  _half_end date;
BEGIN
  _half_end := (SELECT end_on FROM public.education_hour_window('regular', _day));

  IF (_half_end - _day) <= 30 THEN
    RETURN QUERY
    SELECT w.project_id, 'regular'::text, COUNT(*)::int,
           format('이번 반기 정기교육 미달 %s명', COUNT(*)),
           '/app/admin/worker-education'::text
    FROM public.workers w
    WHERE COALESCE(w.is_active, true) = true
      AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general')) IN ('office', 'construction_perm')
      AND NOT public.education_hours_met(w.id, 'regular', _day)
    GROUP BY w.project_id
    HAVING COUNT(*) > 0;
  END IF;

  RETURN QUERY
  SELECT a.project_id, 'certificate'::text, COUNT(DISTINCT a.worker_id)::int,
         format('이수증 없는 오늘 출근 %s명', COUNT(DISTINCT a.worker_id)),
         '/app/admin/worker-education?focus=certificate'::text
  FROM public.v_worker_attendance_today a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.attended = true
    AND a.work_date = _day
    AND public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
        NOT IN ('office', 'construction_perm', 'manager', 'safety_officer')
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_education_records r
      WHERE r.worker_id = w.id
        AND COALESCE(r.is_deleted, false) = false
        AND public.education_record_requirement_subtype(r.education_type) = 'new_hire_construction'
    )
  GROUP BY a.project_id
  HAVING COUNT(DISTINCT a.worker_id) > 0;

  RETURN QUERY
  SELECT i.project_id, 'checkup'::text, COUNT(DISTINCT i.worker_id)::int,
         format('검진 기한 임박 %s명', COUNT(DISTINCT i.worker_id)),
         '/app/admin/health/checkups'::text
  FROM public.worker_required_items i
  WHERE i.item_type = 'checkup'
    AND i.status = 'pending'
    AND COALESCE(i.is_deleted, false) = false
    AND i.due_date IS NOT NULL
    AND i.due_date >= _day
    AND i.due_date <= _day + 7
  GROUP BY i.project_id
  HAVING COUNT(DISTINCT i.worker_id) > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.education_obligation_digest(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.education_obligation_digest(date) TO service_role;
