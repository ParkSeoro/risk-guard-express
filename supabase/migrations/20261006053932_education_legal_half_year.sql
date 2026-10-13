UPDATE public.worker_legal_education_mapping
   SET required_hours = 6, interval_months = 6, first_due_days = 180,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 사무직 반기 6시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'office' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET is_deleted = true, updated_at = now()
 WHERE is_system_default = true AND job_type = 'general' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 12, interval_months = 6, first_due_days = 180,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 상시근로자 반기 12시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'construction_perm' AND education_type = 'regular';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 8, first_due_days = 1,
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
   SET required_hours = 16, interval_months = 12, first_due_days = 365,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 관리감독자 연 16시간',
       updated_at = now()
 WHERE is_system_default = true AND job_type = 'manager' AND education_type = 'manager';

UPDATE public.worker_legal_education_mapping
   SET required_hours = 1, interval_months = 0, first_due_days = 1,
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
   SET required_hours = 2, interval_months = 0, first_due_days = 1,
       legal_basis = '산업안전보건법 시행규칙 제26조 [별표4] - 일용·단기간·간혈 특별교육 2시간. 상시 16시간은 회차 시간으로 나눈다',
       updated_at = now()
 WHERE is_system_default = true AND education_type = 'special';

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
