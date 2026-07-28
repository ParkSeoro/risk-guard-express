-- Map plant standard job names (한글) → legal education mapping keys.
-- workers.job_type stores Korean SSOT names; education seed still uses legacy codes.

CREATE OR REPLACE FUNCTION public.resolve_legal_education_job_type(_job_type text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE trim(both FROM COALESCE(_job_type, ''))
    WHEN '용접공' THEN 'welding'
    WHEN '배관공' THEN 'general'
    WHEN '제관공' THEN 'welding'
    WHEN '취부사' THEN 'welding'
    WHEN '보온공' THEN 'chemical'
    WHEN '도장공' THEN 'chemical'
    WHEN '비파괴검사원' THEN 'general'
    WHEN '전기공' THEN 'electrical'
    WHEN '계장공' THEN 'electrical'
    WHEN '케이블포설공' THEN 'electrical'
    WHEN '통신공' THEN 'electrical'
    WHEN '비계공' THEN 'scaffold'
    WHEN '철골공' THEN 'height'
    WHEN '철근공' THEN 'formwork'
    WHEN '형틀목수' THEN 'formwork'
    WHEN '콘크리트타설공' THEN 'general'
    WHEN '방수공' THEN 'general'
    WHEN '판넬공' THEN 'height'
    WHEN '일반조공' THEN 'general'
    WHEN '중장비운전원' THEN 'heavy_equipment'
    WHEN '양중작업자' THEN 'rigging'
    WHEN '화재감시자' THEN 'hazardous'
    WHEN '밀폐공간감시자' THEN 'confined'
    WHEN '신호수/유도수' THEN 'crane_signal'
    WHEN '안전관리자' THEN 'safety_officer'
    WHEN '관리감독자' THEN 'manager'
    WHEN '' THEN 'general'
    ELSE trim(both FROM COALESCE(_job_type, 'general'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.preview_required_education(_project_id uuid, _job_type text)
RETURNS TABLE (
  education_type text,
  required_hours numeric,
  interval_months int,
  first_due_days int,
  legal_basis text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.education_type)
    m.education_type, m.required_hours, m.interval_months, m.first_due_days, m.legal_basis
  FROM public.worker_legal_education_mapping m
  WHERE m.is_deleted = false
    AND (
      m.job_type = public.resolve_legal_education_job_type(_job_type)
      OR m.job_type = 'all'
    )
    AND (m.is_system_default = true OR m.project_id = _project_id)
  ORDER BY m.education_type, (m.project_id = _project_id) DESC;
$$;
