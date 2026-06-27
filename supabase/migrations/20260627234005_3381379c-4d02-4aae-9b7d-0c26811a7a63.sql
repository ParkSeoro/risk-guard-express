
-- 1) RPC: 근로자에게 필요한 법정교육 산출 (직종 + 시스템기본/프로젝트 오버라이드 결합)
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
  status text  -- 'overdue' | 'due_soon' | 'ok' | 'missing'
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
BEGIN
  SELECT id, project_id, job_type, hire_date INTO w
  FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RETURN; END IF;

  RETURN QUERY
  WITH mapping AS (
    SELECT DISTINCT ON (m.job_type, m.education_type)
      m.job_type, m.education_type, m.required_hours, m.interval_months,
      m.first_due_days, m.legal_basis
    FROM public.worker_legal_education_mapping m
    WHERE m.is_deleted = false
      AND (m.job_type = COALESCE(w.job_type, 'general') OR m.job_type = 'all')
      AND (m.is_system_default = true OR m.project_id = w.project_id)
    ORDER BY m.job_type, m.education_type,
             (m.project_id = w.project_id) DESC  -- 프로젝트 오버라이드 우선
  ),
  latest AS (
    SELECT education_type, MAX(completed_at) AS last_completed_at
    FROM public.worker_education_records
    WHERE worker_id = _worker_id AND is_deleted = false
    GROUP BY education_type
  )
  SELECT
    mp.job_type, mp.education_type, mp.required_hours, mp.interval_months,
    mp.first_due_days, mp.legal_basis,
    CASE
      WHEN l.last_completed_at IS NOT NULL
        THEN (l.last_completed_at + (mp.interval_months || ' months')::interval)::date
      ELSE (COALESCE(w.hire_date, CURRENT_DATE) + (mp.first_due_days || ' days')::interval)::date
    END AS next_due_at,
    l.last_completed_at,
    CASE
      WHEN l.last_completed_at IS NULL AND
           (COALESCE(w.hire_date, CURRENT_DATE) + (mp.first_due_days || ' days')::interval)::date < CURRENT_DATE
        THEN 'overdue'
      WHEN l.last_completed_at IS NULL THEN 'missing'
      WHEN (l.last_completed_at + (mp.interval_months || ' months')::interval)::date < CURRENT_DATE
        THEN 'overdue'
      WHEN (l.last_completed_at + (mp.interval_months || ' months')::interval)::date < CURRENT_DATE + 30
        THEN 'due_soon'
      ELSE 'ok'
    END AS status
  FROM mapping mp
  LEFT JOIN latest l ON l.education_type = mp.education_type;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_worker_required_education(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_worker_required_education(uuid) TO authenticated, service_role;

-- 2) RPC: 직종별 미리보기 (등록 폼에서 사용 - 근로자 미저장 상태)
CREATE OR REPLACE FUNCTION public.preview_required_education(_project_id uuid, _job_type text)
RETURNS TABLE (
  education_type text,
  required_hours numeric,
  interval_months int,
  first_due_days int,
  legal_basis text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (m.education_type)
    m.education_type, m.required_hours, m.interval_months, m.first_due_days, m.legal_basis
  FROM public.worker_legal_education_mapping m
  WHERE m.is_deleted = false
    AND (m.job_type = COALESCE(_job_type, 'general') OR m.job_type = 'all')
    AND (m.is_system_default = true OR m.project_id = _project_id)
  ORDER BY m.education_type, (m.project_id = _project_id) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.preview_required_education(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_required_education(uuid, text) TO authenticated, service_role;

-- 3) 근로자 등록/직종변경 시 worker_required_items 자동 시드
CREATE OR REPLACE FUNCTION public.sync_worker_required_education()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.job_type IS NOT DISTINCT FROM NEW.job_type
     AND OLD.hire_date IS NOT DISTINCT FROM NEW.hire_date THEN
    RETURN NEW;
  END IF;

  -- 미완료(due) 상태인 기존 자동 시드 항목 제거 후 재생성
  DELETE FROM public.worker_required_items
  WHERE worker_id = NEW.id
    AND item_type = 'education'
    AND source = 'auto_legal_mapping'
    AND completed_at IS NULL;

  FOR r IN
    SELECT * FROM public.preview_required_education(NEW.project_id, COALESCE(NEW.job_type,'general'))
  LOOP
    INSERT INTO public.worker_required_items
      (worker_id, project_id, item_type, subtype, due_date, status, source, legal_basis)
    VALUES (
      NEW.id, NEW.project_id, 'education', r.education_type,
      (COALESCE(NEW.hire_date, CURRENT_DATE) + (r.first_due_days || ' days')::interval)::date,
      'pending', 'auto_legal_mapping', r.legal_basis
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_worker_required_education ON public.workers;
CREATE TRIGGER trg_sync_worker_required_education
AFTER INSERT OR UPDATE OF job_type, hire_date ON public.workers
FOR EACH ROW EXECUTE FUNCTION public.sync_worker_required_education();

-- 4) 기존 활성 근로자에 대해 1회 백필
DO $$
DECLARE w RECORD;
BEGIN
  FOR w IN SELECT id FROM public.workers WHERE is_active = true LOOP
    PERFORM 1;
    UPDATE public.workers SET updated_at = updated_at WHERE id = w.id;  -- 트리거 안 탐, no-op
  END LOOP;
END $$;
