-- Card writes close the matching statutory queue only.
-- worker_education_records (Korean ledger labels or English mapping codes) mark that
-- education subtype done. A 배치전 checkup marks pre_placement_health done.
-- Other checkup subtypes and the health-education session trigger stay as they are.

CREATE OR REPLACE FUNCTION public.education_record_requirement_subtype(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(_raw, '')))
    WHEN 'regular' THEN 'regular'
    WHEN '정기' THEN 'regular'
    WHEN 'new_hire' THEN 'new_hire'
    WHEN '채용시' THEN 'new_hire'
    WHEN '신규채용' THEN 'new_hire'
    WHEN 'new_hire_construction' THEN 'new_hire_construction'
    WHEN '기초안전보건' THEN 'new_hire_construction'
    WHEN 'job_change' THEN 'job_change'
    WHEN '작업변경시' THEN 'job_change'
    WHEN '작업변경' THEN 'job_change'
    WHEN 'special' THEN 'special'
    WHEN '특별' THEN 'special'
    WHEN 'manager' THEN 'manager'
    WHEN '관리감독자' THEN 'manager'
    WHEN 'msds' THEN 'msds'
    ELSE NULL
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_worker_education_record_req ON public.worker_education_records;
CREATE TRIGGER trg_worker_education_record_req
  AFTER INSERT OR UPDATE OF education_type, is_deleted
  ON public.worker_education_records
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_worker_education_record_complete_requirement();

CREATE OR REPLACE FUNCTION public.trg_health_checkup_complete_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _subtype text;
  _interval int;
  _mapping record;
  _w record;
  _type text := COALESCE(NEW.type::text, 'general');
BEGIN
  IF NEW.worker_id IS NULL OR NEW.conducted_date IS NULL THEN
    RETURN NEW;
  END IF;

  _subtype := CASE
    WHEN _type IN ('배치전', '배치전검사') OR _type ILIKE '%pre_placement%'
      THEN 'pre_placement_health'
    WHEN _type ILIKE '%special%' OR _type IN ('특수', '특수건강진단')
      THEN 'special_health'
    ELSE 'general_health'
  END;

  UPDATE public.worker_required_items
     SET status = 'done',
         completed_at = now(),
         completed_ref_id = NEW.id,
         updated_at = now()
   WHERE worker_id = NEW.worker_id
     AND item_type = 'checkup'
     AND subtype = _subtype
     AND status IN ('pending', 'overdue')
     AND COALESCE(is_deleted, false) = false;

  -- 배치전은 1회. 다음 주기 행은 만들지 않는다.
  IF _subtype = 'pre_placement_health' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _w FROM public.workers WHERE id = NEW.worker_id;
  IF _w IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _mapping FROM public.worker_legal_education_mapping
   WHERE education_type = _subtype
     AND (project_id IS NULL OR project_id = _w.project_id)
     AND COALESCE(is_deleted, false) = false
   ORDER BY (project_id IS NOT NULL) DESC, updated_at DESC
   LIMIT 1;

  _interval := COALESCE(_mapping.interval_months, 12);

  INSERT INTO public.worker_required_items
    (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
  VALUES (
    NEW.worker_id,
    _w.project_id,
    'checkup',
    _subtype,
    (NEW.conducted_date + (_interval || ' months')::interval)::date,
    'pending',
    'auto',
    _mapping.legal_basis
  );

  RETURN NEW;
END;
$$;
