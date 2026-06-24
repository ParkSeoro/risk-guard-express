
CREATE OR REPLACE FUNCTION public.trg_worker_daily_log_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _age int;
BEGIN
  _age := CASE WHEN NEW.birth_date IS NULL THEN NULL
               ELSE date_part('year', age(CURRENT_DATE, NEW.birth_date))::int END;
  NEW.requires_daily_health_log :=
    (COALESCE(_age,0) >= 65)
    OR COALESCE(NEW.health_grade,'') IN ('D1','D2')
    OR COALESCE(NEW.health_checkup_status::text,'') IN ('유소견D1','유소견D2');
  RETURN NEW;
END; $function$;

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
  IF NOT FOUND OR COALESCE(_w.is_active,true) = false THEN RETURN 0; END IF;

  _job := COALESCE(_w.job_type, 'general');
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
      WHERE COALESCE(m.is_deleted,false) = false
        AND (m.project_id IS NULL OR m.project_id = _w.project_id)
        AND (
          m.job_type = _job
          OR (_has_hazardous AND m.job_type IN ('hazardous','chemical'))
          OR (m.job_type = 'general' AND _job NOT IN ('office','manager'))
        )
    )
    SELECT * FROM ranked WHERE rn = 1
  LOOP
    _due := _base + COALESCE(_m.first_due_days, 0);

    IF EXISTS (
      SELECT 1 FROM public.worker_required_items
      WHERE worker_id = _worker_id
        AND item_type = CASE WHEN _m.education_type LIKE '%health' THEN 'checkup' ELSE 'education' END
        AND subtype = _m.education_type
        AND status = 'pending'
        AND COALESCE(is_deleted,false) = false
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
      AND due_date = CURRENT_DATE AND COALESCE(is_deleted,false) = false
  ) THEN
    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (_worker_id, _w.project_id, 'daily_log',
      CASE WHEN COALESCE(_w.health_grade,'') IN ('D1','D2')
              OR COALESCE(_w.health_checkup_status::text,'') IN ('유소견D1','유소견D2')
           THEN 'health_d' ELSE 'age65' END,
      CURRENT_DATE, 'pending', 'auto',
      '산업안전보건법 제129조 / 고령자 건강관리 지침');
    _count := _count + 1;
  END IF;

  RETURN _count;
END; $function$;
