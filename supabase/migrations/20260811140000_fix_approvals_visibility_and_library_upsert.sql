-- 1) 결재(approvals) SELECT: 프로젝트 멤버면 전 단계 조회
--    기존 company-scoped RLS 때문에 시공사 작성자가 발주처(SM/CM) 단계를 못 봄
--    → 결재현황에서 SM 누락 + 잘못된 "발주처 없음" 안내
--
-- 2) promote_run_to_global_risk_library: 동일 content_hash 다건 INSERT…ON CONFLICT
--    → "ON CONFLICT DO UPDATE command cannot affect row a second time"
--    (현장소장 최종승인 시 assessment_runs→승인완료 트리거에서 발생)

-- ---------- approvals visibility ----------
DROP POLICY IF EXISTS "Company-scoped view: approvals" ON public.approvals;
DROP POLICY IF EXISTS "Project members can view approvals" ON public.approvals;
DROP POLICY IF EXISTS "Members can view approvals" ON public.approvals;

CREATE POLICY "Project members can view approvals"
  ON public.approvals
  FOR SELECT
  TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

COMMENT ON POLICY "Project members can view approvals" ON public.approvals IS
  '결재 체인은 발주처·시공사·협력사를 가로지르므로 프로젝트 멤버에게 전 단계 공개';

-- ---------- global library upsert: dedupe hashes in one statement ----------
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
    SELECT DISTINCT ON (
      public.risk_library_content_hash(
        public.normalize_process_key(ri.process),
        ri.sub_task,
        ri.hazard
      )
    )
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
      true AS is_active
    FROM public.risk_items ri
    WHERE ri.run_id = _run_id
      AND COALESCE(ri.is_deleted, false) = false
      AND COALESCE(ri.is_excluded, false) = false
      AND COALESCE(ri.note, '') NOT LIKE '%AI_SCOPE_DRAFT%'
      AND length(trim(COALESCE(ri.sub_task, ''))) >= 2
      AND length(trim(COALESCE(ri.hazard, ''))) >= 2
      AND length(trim(COALESCE(ri.hazard_situation, ''))) >= 4
      AND length(trim(COALESCE(ri.improvement_measure, ''))) >= 4
    ORDER BY
      public.risk_library_content_hash(
        public.normalize_process_key(ri.process),
        ri.sub_task,
        ri.hazard
      ),
      length(trim(COALESCE(ri.improvement_measure, ''))) DESC,
      length(trim(COALESCE(ri.hazard_situation, ''))) DESC,
      ri.updated_at DESC NULLS LAST
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
  RETURN _n;
END;
$body$;

REVOKE ALL ON FUNCTION public.promote_run_to_global_risk_library(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.promote_run_to_global_risk_library(uuid) TO authenticated, service_role;

-- 라이브러리 승격 실패가 최종승인을 롤백하지 않도록 방어
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
