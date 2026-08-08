-- Global risk library (system-wide) + risk_items classification columns
-- + auto-promote on assessment_run 승인완료
-- Performance: indexed process_key lookups; set-based upsert; no full-table scans in app path.

ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS hazard_type text,
  ADD COLUMN IF NOT EXISTS work_phase text;

COMMENT ON COLUMN public.risk_items.hazard_type IS '유해·위험요인 유형 (추락/끼임/충돌 등)';
COMMENT ON COLUMN public.risk_items.work_phase IS '작업단계: 준비|본작업|마무리|이상시';

CREATE TABLE IF NOT EXISTS public.global_risk_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  process_key text NOT NULL,
  process_label text NOT NULL,
  work_phase text,
  sub_task text NOT NULL,
  hazard text NOT NULL,
  hazard_type text,
  hazard_situation text NOT NULL DEFAULT '',
  existing_measure text NOT NULL DEFAULT '',
  improvement_measure text NOT NULL DEFAULT '',
  likelihood_grade text NOT NULL DEFAULT '중',
  severity_grade text NOT NULL DEFAULT '중',
  risk_grade text NOT NULL DEFAULT '중',
  improved_likelihood_grade text NOT NULL DEFAULT '하',
  improved_severity_grade text NOT NULL DEFAULT '하',
  improved_risk_grade text NOT NULL DEFAULT '하',
  frequency int NOT NULL DEFAULT 2,
  severity int NOT NULL DEFAULT 2,
  improved_frequency int NOT NULL DEFAULT 1,
  improved_severity int NOT NULL DEFAULT 1,
  ppe text[] NOT NULL DEFAULT '{}',
  legal_basis text[] NOT NULL DEFAULT '{}',
  equipment_keys text[] NOT NULL DEFAULT '{}',
  condition_keys text[] NOT NULL DEFAULT '{}',
  content_hash text NOT NULL,
  source text NOT NULL DEFAULT 'approved_run',
  source_run_id uuid,
  use_count int NOT NULL DEFAULT 0,
  quality_score int NOT NULL DEFAULT 50,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT global_risk_library_content_hash_key UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_global_risk_library_process_active
  ON public.global_risk_library (process_key, is_active)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_global_risk_library_hazard_type
  ON public.global_risk_library (hazard_type)
  WHERE is_active = true;

CREATE TABLE IF NOT EXISTS public.global_risk_library_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'draft',
  source_kind text NOT NULL DEFAULT 'excel',
  file_name text,
  row_count int NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_global_risk_library_imports_status
  ON public.global_risk_library_imports (status, created_at DESC);

ALTER TABLE public.global_risk_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.global_risk_library_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grl_select ON public.global_risk_library;
CREATE POLICY grl_select ON public.global_risk_library
  FOR SELECT TO authenticated
  USING (is_active = true OR public.is_master(auth.uid()));

DROP POLICY IF EXISTS grl_master_write ON public.global_risk_library;
CREATE POLICY grl_master_write ON public.global_risk_library
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

DROP POLICY IF EXISTS grli_master ON public.global_risk_library_imports;
CREATE POLICY grli_master ON public.global_risk_library_imports
  FOR ALL TO authenticated
  USING (public.is_master(auth.uid()))
  WITH CHECK (public.is_master(auth.uid()));

GRANT SELECT ON public.global_risk_library TO authenticated;
GRANT ALL ON public.global_risk_library TO service_role;
GRANT ALL ON public.global_risk_library_imports TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.normalize_process_key(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT lower(trim(regexp_replace(COALESCE(_raw, ''), '\s+', ' ', 'g')));
$body$;

CREATE OR REPLACE FUNCTION public.risk_library_content_hash(
  _process_key text,
  _sub_task text,
  _hazard text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT md5(
    COALESCE(_process_key, '') || '||' ||
    lower(trim(COALESCE(_sub_task, ''))) || '||' ||
    lower(trim(COALESCE(_hazard, '')))
  );
$body$;

-- Strip obvious PII / site names from free text (best-effort, keep short).
CREATE OR REPLACE FUNCTION public.scrub_library_text(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT trim(BOTH FROM regexp_replace(
    regexp_replace(COALESCE(_raw, ''), '(담당|작성자|승인자)\s*[:：]?\s*\S+', '', 'g'),
    '\s{2,}', ' ', 'g'
  ));
$body$;

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
    public.normalize_process_key(ri.process),
    trim(ri.process),
    NULLIF(trim(COALESCE(ri.work_phase, '')), ''),
    public.scrub_library_text(ri.sub_task),
    public.scrub_library_text(ri.hazard),
    NULLIF(trim(COALESCE(ri.hazard_type, '')), ''),
    public.scrub_library_text(COALESCE(ri.hazard_situation, '')),
    public.scrub_library_text(COALESCE(ri.existing_measure, '')),
    public.scrub_library_text(COALESCE(ri.improvement_measure, '')),
    COALESCE(NULLIF(ri.likelihood_grade, ''), '중'),
    COALESCE(NULLIF(ri.severity_grade, ''), '중'),
    COALESCE(NULLIF(ri.risk_grade, ''), '중'),
    COALESCE(NULLIF(ri.improved_likelihood_grade, ''), '하'),
    COALESCE(NULLIF(ri.improved_severity_grade, ''), '하'),
    COALESCE(NULLIF(ri.improved_risk_grade, ''), '하'),
    COALESCE(ri.frequency, 2),
    COALESCE(ri.severity, 2),
    COALESCE(ri.improved_frequency, 1),
    COALESCE(ri.improved_severity, 1),
    COALESCE(ri.ppe, '{}'),
    COALESCE(ri.legal_basis, '{}'),
    '{}',
    '{}',
    public.risk_library_content_hash(
      public.normalize_process_key(ri.process),
      ri.sub_task,
      ri.hazard
    ),
    'approved_run',
    _run_id,
    1,
    CASE WHEN COALESCE(ri.risk_grade, '') = '상' THEN 70 ELSE 55 END,
    true
  FROM public.risk_items ri
  WHERE ri.run_id = _run_id
    AND COALESCE(ri.is_deleted, false) = false
    AND COALESCE(ri.is_excluded, false) = false
    AND COALESCE(ri.note, '') NOT LIKE '%AI_SCOPE_DRAFT%'
    AND length(trim(COALESCE(ri.sub_task, ''))) >= 2
    AND length(trim(COALESCE(ri.hazard, ''))) >= 2
    AND length(trim(COALESCE(ri.hazard_situation, ''))) >= 4
    AND length(trim(COALESCE(ri.improvement_measure, ''))) >= 4
  ON CONFLICT (content_hash) DO UPDATE SET
    use_count = g.use_count + 1,
    updated_at = now(),
    -- Prefer richer text when incoming is longer
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
  RETURN _n;
END;
$body$;

REVOKE ALL ON FUNCTION public.promote_run_to_global_risk_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_run_to_global_risk_library(uuid) TO authenticated, service_role;

-- Bulk learn from existing approved runs (master). Cap per call to avoid long locks.
CREATE OR REPLACE FUNCTION public.ingest_approved_runs_to_global_library(_limit int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _run RECORD;
  _total int := 0;
  _runs int := 0;
  _n int;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master only';
  END IF;

  FOR _run IN
    SELECT ar.id
      FROM public.assessment_runs ar
     WHERE ar.status = '승인완료'
       AND COALESCE(ar.is_deleted, false) = false
     ORDER BY ar.updated_at DESC NULLS LAST, ar.created_at DESC
     LIMIT GREATEST(1, LEAST(COALESCE(_limit, 30), 100))
  LOOP
    _n := public.promote_run_to_global_risk_library(_run.id);
    _total := _total + _n;
    _runs := _runs + 1;
  END LOOP;

  RETURN jsonb_build_object('runs', _runs, 'upserted', _total);
END;
$body$;

REVOKE ALL ON FUNCTION public.ingest_approved_runs_to_global_library(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_approved_runs_to_global_library(int) TO authenticated, service_role;

-- Publish master import drafts into global library
CREATE OR REPLACE FUNCTION public.publish_global_risk_library_import(_import_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _imp public.global_risk_library_imports%ROWTYPE;
  _row jsonb;
  _n int := 0;
  _process text;
  _sub text;
  _hazard text;
  _hash text;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master only';
  END IF;

  SELECT * INTO _imp FROM public.global_risk_library_imports WHERE id = _import_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import not found';
  END IF;
  IF _imp.status = 'published' THEN
    RETURN jsonb_build_object('upserted', 0, 'status', 'already_published');
  END IF;

  FOR _row IN SELECT * FROM jsonb_array_elements(COALESCE(_imp.payload, '[]'::jsonb))
  LOOP
    _process := trim(COALESCE(_row->>'process', _row->>'process_label', ''));
    _sub := trim(COALESCE(_row->>'sub_task', ''));
    _hazard := trim(COALESCE(_row->>'hazard', ''));
    IF length(_process) < 1 OR length(_sub) < 2 OR length(_hazard) < 2 THEN
      CONTINUE;
    END IF;
    _hash := public.risk_library_content_hash(
      public.normalize_process_key(_process), _sub, _hazard
    );

    INSERT INTO public.global_risk_library AS g (
      process_key, process_label, work_phase, sub_task, hazard, hazard_type,
      hazard_situation, existing_measure, improvement_measure,
      likelihood_grade, severity_grade, risk_grade,
      improved_likelihood_grade, improved_severity_grade, improved_risk_grade,
      ppe, legal_basis, equipment_keys, condition_keys,
      content_hash, source, use_count, quality_score, is_active
    ) VALUES (
      public.normalize_process_key(_process),
      _process,
      NULLIF(trim(COALESCE(_row->>'work_phase', '')), ''),
      public.scrub_library_text(_sub),
      public.scrub_library_text(_hazard),
      NULLIF(trim(COALESCE(_row->>'hazard_type', '')), ''),
      public.scrub_library_text(COALESCE(_row->>'hazard_situation', '')),
      public.scrub_library_text(COALESCE(_row->>'existing_measure', '')),
      public.scrub_library_text(COALESCE(_row->>'improvement_measure', '')),
      COALESCE(NULLIF(_row->>'likelihood_grade', ''), '중'),
      COALESCE(NULLIF(_row->>'severity_grade', ''), '중'),
      COALESCE(NULLIF(_row->>'risk_grade', ''), '중'),
      COALESCE(NULLIF(_row->>'improved_likelihood_grade', ''), '하'),
      COALESCE(NULLIF(_row->>'improved_severity_grade', ''), '하'),
      COALESCE(NULLIF(_row->>'improved_risk_grade', ''), '하'),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(_row->'ppe', '[]'::jsonb))),
        '{}'
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(_row->'legal_basis', '[]'::jsonb))),
        '{}'
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(_row->'equipment_keys', '[]'::jsonb))),
        '{}'
      ),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(COALESCE(_row->'condition_keys', '[]'::jsonb))),
        '{}'
      ),
      _hash,
      'master_import',
      1,
      60,
      true
    )
    ON CONFLICT (content_hash) DO UPDATE SET
      use_count = g.use_count + 1,
      updated_at = now(),
      is_active = true,
      source = 'master_import';

    _n := _n + 1;
  END LOOP;

  UPDATE public.global_risk_library_imports
     SET status = 'published',
         published_at = now(),
         reviewed_by = auth.uid(),
         updated_at = now(),
         row_count = _n
   WHERE id = _import_id;

  RETURN jsonb_build_object('upserted', _n, 'status', 'published');
END;
$body$;

REVOKE ALL ON FUNCTION public.publish_global_risk_library_import(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_global_risk_library_import(uuid) TO authenticated, service_role;

-- Hook into approval notify (preserve high-risk followups)
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

    -- Global library promote (set-based, indexed unique hash — must stay fast)
    PERFORM public.promote_run_to_global_risk_library(NEW.id);

    IF to_regprocedure('public.ensure_high_risk_item_followup(uuid)') IS NOT NULL THEN
      FOR _item_id IN
        SELECT ri.id
          FROM public.risk_items ri
         WHERE ri.run_id = NEW.id
           AND COALESCE(ri.is_deleted, false) = false
           AND COALESCE(ri.is_excluded, false) = false
           AND public.is_focus_high_risk_item(ri.risk_grade, ri.improved_risk_grade)
      LOOP
        PERFORM public.ensure_high_risk_item_followup(_item_id);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$body$;
