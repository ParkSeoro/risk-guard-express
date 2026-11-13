-- 2026-11-04 위험성평가 지침 합의.
-- 보존 잠금, 수시 사유, 근로자대표 협의, 가이드 끄기, 공종 별칭, 표준 표 복사, 마스킹.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ra_guide_hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS occasional_reason text,
  ADD COLUMN IF NOT EXISTS rep_participation_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rep_schedule text,
  ADD COLUMN IF NOT EXISTS rep_scope text,
  ADD COLUMN IF NOT EXISTS rep_method text,
  ADD COLUMN IF NOT EXISTS improvement_plan_completed_on date,
  ADD COLUMN IF NOT EXISTS library_promoted_count integer;

CREATE TABLE IF NOT EXISTS public.worker_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  worker_id uuid REFERENCES public.workers(id) ON DELETE SET NULL,
  worker_name text,
  method text NOT NULL DEFAULT 'majority',
  appointed_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT worker_representatives_method_chk
    CHECK (method IN ('union', 'majority', 'none'))
);

CREATE UNIQUE INDEX IF NOT EXISTS worker_representatives_one_active
  ON public.worker_representatives (project_id, company_id)
  WHERE ended_at IS NULL;

ALTER TABLE public.worker_representatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worker_representatives_select ON public.worker_representatives;
CREATE POLICY worker_representatives_select
  ON public.worker_representatives
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = worker_representatives.project_id
        AND pm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS worker_representatives_write ON public.worker_representatives;
CREATE POLICY worker_representatives_write
  ON public.worker_representatives
  FOR ALL TO authenticated
  USING (
    public.has_project_role(
      auth.uid(),
      project_id,
      ARRAY['project_admin', 'site_supervisor', 'safety_manager', 'site_manager']::public.project_role[]
    )
  )
  WITH CHECK (
    public.has_project_role(
      auth.uid(),
      project_id,
      ARRAY['project_admin', 'site_supervisor', 'safety_manager', 'site_manager']::public.project_role[]
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.worker_representatives TO authenticated;

CREATE OR REPLACE FUNCTION public.normalize_process_key(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT CASE replace(lower(trim(regexp_replace(COALESCE(_raw, ''), '\s+', ' ', 'g'))), ' ', '')
    WHEN '철근배근' THEN '철근 배근'
    ELSE lower(trim(regexp_replace(COALESCE(_raw, ''), '\s+', ' ', 'g')))
  END;
$body$;

CREATE OR REPLACE FUNCTION public.scrub_library_text(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT trim(BOTH FROM regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            COALESCE(_raw, ''),
            '(담당|작성자|승인자)\s*[:：]?\s*\S+',
            '',
            'g'
          ),
          '(주식회사|㈜|\(주\)|（주）)\s*\S+',
          '',
          'g'
        ),
        '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
        '',
        'g'
      ),
      '01[0-9]-?[0-9]{3,4}-?[0-9]{4}',
      '',
      'g'
    ),
    '\s{2,}',
    ' ',
    'g'
  ));
$body$;

CREATE OR REPLACE FUNCTION public.assessment_retention_locked(_completed date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $body$
  SELECT _completed IS NOT NULL
    AND ((_completed + 1) + interval '3 years')::date > (timezone('Asia/Seoul', now()))::date;
$body$;

CREATE OR REPLACE FUNCTION public.trg_block_assessment_run_retention()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF public.assessment_retention_locked(OLD.improvement_plan_completed_on) THEN
      RAISE EXCEPTION '개선대책 수립이 끝난 회차는 다음 날부터 3년 동안 삭제할 수 없습니다';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.is_deleted IS TRUE AND COALESCE(OLD.is_deleted, false) IS NOT TRUE
     AND public.assessment_retention_locked(COALESCE(NEW.improvement_plan_completed_on, OLD.improvement_plan_completed_on)) THEN
    RAISE EXCEPTION '개선대책 수립이 끝난 회차는 보존 중입니다. 3년이 지나기 전에는 휴지통으로 옮길 수 없습니다';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_block_assessment_run_retention ON public.assessment_runs;
CREATE TRIGGER trg_block_assessment_run_retention
  BEFORE DELETE OR UPDATE ON public.assessment_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_assessment_run_retention();

CREATE OR REPLACE FUNCTION public.trg_block_risk_item_retention()
RETURNS trigger
LANGUAGE plpgsql
AS $body$
DECLARE
  _completed date;
  _run uuid;
BEGIN
  _run := CASE WHEN TG_OP = 'DELETE' THEN OLD.run_id ELSE COALESCE(NEW.run_id, OLD.run_id) END;
  IF _run IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT improvement_plan_completed_on INTO _completed
    FROM public.assessment_runs
   WHERE id = _run;
  IF NOT public.assessment_retention_locked(_completed) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '보존 중인 위험성평가 항목은 3년이 지나기 전에 삭제할 수 없습니다';
  END IF;
  IF NEW.is_deleted IS TRUE AND COALESCE(OLD.is_deleted, false) IS NOT TRUE THEN
    RAISE EXCEPTION '보존 중인 위험성평가 항목은 3년이 지나기 전에 휴지통으로 옮길 수 없습니다';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_block_risk_item_retention ON public.risk_items;
CREATE TRIGGER trg_block_risk_item_retention
  BEFORE DELETE OR UPDATE ON public.risk_items
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_block_risk_item_retention();

CREATE OR REPLACE FUNCTION public.promote_run_to_global_risk_library(_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _n int := 0;
BEGIN
  IF _run_id IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO public.global_risk_library AS g (
    process_key, process_label, work_phase, sub_task, hazard, hazard_type,
    hazard_situation, existing_measure, improvement_measure,
    likelihood_grade, severity_grade, risk_grade,
    improved_likelihood_grade, improved_severity_grade, improved_risk_grade,
    frequency, severity, improved_frequency, improved_severity,
    ppe, legal_basis, equipment_keys, condition_keys,
    content_hash, source, source_run_id, use_count, quality_score, is_active
  )
  SELECT
    process_key, process_label, work_phase, sub_task, hazard, hazard_type,
    hazard_situation, existing_measure, improvement_measure,
    likelihood_grade, severity_grade, risk_grade,
    improved_likelihood_grade, improved_severity_grade, improved_risk_grade,
    frequency, severity, improved_frequency, improved_severity,
    ppe, legal_basis, equipment_keys, condition_keys,
    content_hash, source, source_run_id, use_count, quality_score, is_active
  FROM (
    SELECT DISTINCT ON (hashed.content_hash)
      hashed.*
    FROM (
      SELECT
        public.normalize_process_key(ri.process) AS process_key,
        trim(ri.process) AS process_label,
        NULLIF(trim(COALESCE(ri.work_phase, '')), '') AS work_phase,
        public.scrub_library_text(ri.sub_task) AS sub_task,
        public.scrub_library_text(ri.hazard) AS hazard,
        NULLIF(trim(COALESCE(ri.hazard_type, '')), '') AS hazard_type,
        public.scrub_library_text(COALESCE(ri.hazard_situation, '')) AS hazard_situation,
        public.scrub_library_text(COALESCE(ri.existing_measure, '')) AS existing_measure,
        public.scrub_library_text(COALESCE(ri.improvement_measure, '')) AS improvement_measure,
        COALESCE(NULLIF(ri.likelihood_grade, ''), '중') AS likelihood_grade,
        COALESCE(NULLIF(ri.severity_grade, ''), '중') AS severity_grade,
        COALESCE(NULLIF(ri.risk_grade, ''), '중') AS risk_grade,
        COALESCE(NULLIF(ri.improved_likelihood_grade, ''), '하') AS improved_likelihood_grade,
        COALESCE(NULLIF(ri.improved_severity_grade, ''), '하') AS improved_severity_grade,
        COALESCE(NULLIF(ri.improved_risk_grade, ''), '하') AS improved_risk_grade,
        COALESCE(ri.frequency, 2) AS frequency,
        COALESCE(ri.severity, 2) AS severity,
        COALESCE(ri.improved_frequency, 1) AS improved_frequency,
        COALESCE(ri.improved_severity, 1) AS improved_severity,
        COALESCE(ri.ppe, '{}') AS ppe,
        COALESCE(ri.legal_basis, '{}') AS legal_basis,
        '{}'::text[] AS equipment_keys,
        '{}'::text[] AS condition_keys,
        public.risk_library_content_hash(
          public.normalize_process_key(ri.process),
          ri.sub_task,
          ri.hazard
        ) AS content_hash,
        'approved_run'::text AS source,
        _run_id AS source_run_id,
        1 AS use_count,
        CASE WHEN COALESCE(ri.risk_grade, '') = '상' THEN 70 ELSE 55 END AS quality_score,
        true AS is_active,
        length(trim(COALESCE(ri.improvement_measure, ''))) AS improvement_len,
        length(trim(COALESCE(ri.hazard_situation, ''))) AS situation_len,
        ri.updated_at
      FROM public.risk_items ri
      WHERE ri.run_id = _run_id
        AND COALESCE(ri.is_deleted, false) = false
        AND COALESCE(ri.is_excluded, false) = false
        AND COALESCE(ri.note, '') NOT LIKE '%AI_SCOPE_DRAFT%'
        AND length(trim(COALESCE(ri.sub_task, ''))) >= 2
        AND length(trim(COALESCE(ri.hazard, ''))) >= 2
        AND length(trim(COALESCE(ri.hazard_situation, ''))) >= 4
        AND length(trim(COALESCE(ri.improvement_measure, ''))) >= 4
    ) hashed
    ORDER BY
      hashed.content_hash,
      hashed.improvement_len DESC,
      hashed.situation_len DESC,
      hashed.updated_at DESC NULLS LAST
  ) src
  ON CONFLICT (content_hash) DO UPDATE SET
    use_count = g.use_count + 1,
    updated_at = now(),
    hazard_situation = CASE
      WHEN length(EXCLUDED.hazard_situation) > length(g.hazard_situation)
      THEN EXCLUDED.hazard_situation ELSE g.hazard_situation END,
    existing_measure = CASE
      WHEN length(EXCLUDED.existing_measure) > length(g.existing_measure)
      THEN EXCLUDED.existing_measure ELSE g.existing_measure END,
    improvement_measure = CASE
      WHEN length(EXCLUDED.improvement_measure) > length(g.improvement_measure)
      THEN EXCLUDED.improvement_measure ELSE g.improvement_measure END,
    work_phase = COALESCE(EXCLUDED.work_phase, g.work_phase),
    hazard_type = COALESCE(EXCLUDED.hazard_type, g.hazard_type),
    ppe = CASE WHEN cardinality(EXCLUDED.ppe) > cardinality(g.ppe) THEN EXCLUDED.ppe ELSE g.ppe END,
    legal_basis = CASE
      WHEN cardinality(EXCLUDED.legal_basis) > cardinality(g.legal_basis)
      THEN EXCLUDED.legal_basis ELSE g.legal_basis END,
    quality_score = GREATEST(g.quality_score, EXCLUDED.quality_score),
    is_active = true;

  GET DIAGNOSTICS _n = ROW_COUNT;
  UPDATE public.assessment_runs
     SET library_promoted_count = _n
   WHERE id = _run_id;
  RETURN _n;
END;
$body$;

INSERT INTO public.global_risk_library (
  process_key, process_label, sub_task, hazard,
  hazard_situation, existing_measure, improvement_measure,
  likelihood_grade, severity_grade, risk_grade,
  ppe, legal_basis, equipment_keys, condition_keys,
  content_hash, source, use_count, quality_score, is_active
)
SELECT
  public.normalize_process_key(s.category_large),
  trim(s.category_large),
  public.scrub_library_text(s.sub_task),
  public.scrub_library_text(s.hazard),
  public.scrub_library_text(COALESCE(s.hazard_situation, '')),
  public.scrub_library_text(COALESCE(s.existing_measure, '')),
  public.scrub_library_text(COALESCE(s.improvement_measure, '')),
  COALESCE(NULLIF(s.default_likelihood_grade, ''), '중'),
  COALESCE(NULLIF(s.default_severity_grade, ''), '중'),
  CASE
    WHEN s.default_likelihood_grade = '상' OR s.default_severity_grade = '상' THEN '상'
    WHEN s.default_likelihood_grade = '중' OR s.default_severity_grade = '중' THEN '중'
    ELSE '하'
  END,
  COALESCE(s.recommended_ppe, '{}'),
  COALESCE(s.legal_refs, '{}'),
  COALESCE(s.equipment, '{}'),
  COALESCE(s.tags, '{}'),
  public.risk_library_content_hash(
    public.normalize_process_key(s.category_large),
    s.sub_task,
    s.hazard
  ),
  'standard',
  0,
  40,
  true
FROM public.standard_risk_library s
WHERE COALESCE(s.is_active, true) = true
  AND length(trim(COALESCE(s.category_large, ''))) >= 1
  AND length(trim(COALESCE(s.sub_task, ''))) >= 2
  AND length(trim(COALESCE(s.hazard, ''))) >= 2
ON CONFLICT (content_hash) DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_unconfirmed_assessment_workers(
  _project_id uuid,
  _worker_ids uuid[] DEFAULT NULL,
  _phones text[] DEFAULT NULL
)
RETURNS TABLE (
  worker_id uuid,
  worker_name text,
  run_id uuid,
  period_label text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  WITH wanted AS (
    SELECT w.id, w.name, w.company_id, w.phone
      FROM public.workers w
     WHERE w.project_id = _project_id
       AND COALESCE(w.is_active, true) = true
       AND (
         (COALESCE(cardinality(_worker_ids), 0) > 0 AND w.id = ANY(_worker_ids))
         OR (
           COALESCE(cardinality(_phones), 0) > 0
           AND public.normalize_phone_digits(COALESCE(w.phone, '')) <> ''
           AND public.normalize_phone_digits(w.phone) = ANY (
             SELECT public.normalize_phone_digits(p) FROM unnest(COALESCE(_phones, ARRAY[]::text[])) AS p
           )
         )
       )
  ),
  latest AS (
    SELECT DISTINCT ON (w.id)
      w.id AS worker_id,
      w.name AS worker_name,
      ar.id AS run_id,
      ar.period_label
    FROM wanted w
    JOIN public.assessment_runs ar
      ON ar.project_id = _project_id
     AND ar.status = '승인완료'
     AND COALESCE(ar.is_deleted, false) = false
     AND (
       w.company_id IS NULL
       OR ar.target_company_ids IS NULL
       OR cardinality(ar.target_company_ids) = 0
       OR w.company_id = ANY(ar.target_company_ids)
     )
    ORDER BY w.id, ar.updated_at DESC NULLS LAST
  )
  SELECT l.worker_id, l.worker_name, l.run_id, l.period_label
    FROM latest l
   WHERE NOT EXISTS (
     SELECT 1 FROM public.assessment_run_share_acks a
      WHERE a.run_id = l.run_id
        AND a.worker_id = l.worker_id
   );
$body$;

REVOKE ALL ON FUNCTION public.list_unconfirmed_assessment_workers(uuid, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_unconfirmed_assessment_workers(uuid, uuid[], text[]) TO authenticated, service_role;
