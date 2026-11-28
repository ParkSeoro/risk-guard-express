-- Root cause fix: promote_run_to_global_risk_library() failed on every approved run because
-- UPDATE public.assessment_runs SET library_promoted_count = _n tripped enforce_submitted_document_lock(),
-- rolling back the entire INSERT INTO global_risk_library subtransaction inside trg_assessment_run_approved_notify().
-- Setting app.skip_document_edit_lock = '1' locally fixes both live approval promotion and historical backfill.

CREATE OR REPLACE FUNCTION public.promote_run_to_global_risk_library(_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    SELECT DISTINCT ON (content_hash)
      process_key, process_label, work_phase, sub_task, hazard, hazard_type,
      hazard_situation, existing_measure, improvement_measure,
      likelihood_grade, severity_grade, risk_grade,
      improved_likelihood_grade, improved_severity_grade, improved_risk_grade,
      frequency, severity, improved_frequency, improved_severity,
      ppe, legal_basis, equipment_keys, condition_keys,
      content_hash, source, source_run_id, use_count, quality_score, is_active
    FROM (
      SELECT
        public.normalize_process_key(ri.process) AS process_key,
        trim(ri.process) AS process_label,
        NULLIF(trim(COALESCE(ri.work_phase, '')), '') AS work_phase,
        public.scrub_library_text(ri.sub_task) AS sub_task,
        public.scrub_library_text(ri.hazard) AS hazard,
        NULLIF(trim(COALESCE(ri.hazard_type, '')), '') AS hazard_type,
        public.scrub_library_text(ri.hazard_situation) AS hazard_situation,
        public.scrub_library_text(ri.existing_measure) AS existing_measure,
        public.scrub_library_text(ri.improvement_measure) AS improvement_measure,
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
        public.risk_library_content_hash(public.normalize_process_key(ri.process), ri.sub_task, ri.hazard) AS content_hash,
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
    ORDER BY content_hash, improvement_len DESC, situation_len DESC, updated_at DESC NULLS LAST
  ) src
  ON CONFLICT (content_hash) DO UPDATE SET
    use_count = g.use_count + 1,
    updated_at = now(),
    hazard_situation = CASE WHEN length(EXCLUDED.hazard_situation) > length(g.hazard_situation) THEN EXCLUDED.hazard_situation ELSE g.hazard_situation END,
    existing_measure = CASE WHEN length(EXCLUDED.existing_measure) > length(g.existing_measure) THEN EXCLUDED.existing_measure ELSE g.existing_measure END,
    improvement_measure = CASE WHEN length(EXCLUDED.improvement_measure) > length(g.improvement_measure) THEN EXCLUDED.improvement_measure ELSE g.improvement_measure END,
    work_phase = COALESCE(EXCLUDED.work_phase, g.work_phase),
    hazard_type = COALESCE(EXCLUDED.hazard_type, g.hazard_type),
    ppe = CASE WHEN cardinality(EXCLUDED.ppe) > cardinality(g.ppe) THEN EXCLUDED.ppe ELSE g.ppe END,
    legal_basis = CASE WHEN cardinality(EXCLUDED.legal_basis) > cardinality(g.legal_basis) THEN EXCLUDED.legal_basis ELSE g.legal_basis END,
    quality_score = GREATEST(g.quality_score, EXCLUDED.quality_score),
    is_active = true;

  GET DIAGNOSTICS _n = ROW_COUNT;

  PERFORM set_config('app.skip_document_edit_lock', '1', true);
  UPDATE public.assessment_runs
     SET library_promoted_count = _n
   WHERE id = _run_id;

  RETURN _n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_promote_approved_run_to_library()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;
