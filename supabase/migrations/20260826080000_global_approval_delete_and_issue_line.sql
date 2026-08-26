-- Project-wide (all companies): cancel the approval line when any inbox
-- document is soft-deleted, and never issue a work permit unless its own
-- issue-line is complete — even when approval RPCs set skip_work_permit_edit_lock.

CREATE OR REPLACE FUNCTION public.trg_cancel_approvals_on_entity_soft_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_type text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.is_deleted IS TRUE
     AND COALESCE(OLD.is_deleted, false) IS FALSE THEN
    v_type := CASE TG_TABLE_NAME
      WHEN 'work_permits' THEN 'work_permit'
      WHEN 'work_plans' THEN 'work_plan'
      WHEN 'assessment_runs' THEN 'assessment_run'
      ELSE NULL
    END;
    IF v_type IS NOT NULL THEN
      PERFORM public.cancel_open_approvals_for_entity(v_type, NEW.id, '[문서삭제]');
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cancel_approvals_on_permit_delete ON public.work_permits;
DROP TRIGGER IF EXISTS trg_cancel_approvals_on_entity_soft_delete ON public.work_permits;
CREATE TRIGGER trg_cancel_approvals_on_entity_soft_delete
AFTER UPDATE OF is_deleted ON public.work_permits
FOR EACH ROW
EXECUTE FUNCTION public.trg_cancel_approvals_on_entity_soft_delete();

DROP TRIGGER IF EXISTS trg_cancel_approvals_on_entity_soft_delete ON public.work_plans;
CREATE TRIGGER trg_cancel_approvals_on_entity_soft_delete
AFTER UPDATE OF is_deleted ON public.work_plans
FOR EACH ROW
EXECUTE FUNCTION public.trg_cancel_approvals_on_entity_soft_delete();

DROP TRIGGER IF EXISTS trg_cancel_approvals_on_entity_soft_delete ON public.assessment_runs;
CREATE TRIGGER trg_cancel_approvals_on_entity_soft_delete
AFTER UPDATE OF is_deleted ON public.assessment_runs
FOR EACH ROW
EXECUTE FUNCTION public.trg_cancel_approvals_on_entity_soft_delete();

-- Heal leftover open rows on already-deleted plans / RA runs
SELECT public.cancel_open_approvals_for_entity('work_plan', wp.id, '[문서삭제]')
  FROM public.work_plans wp
 WHERE COALESCE(wp.is_deleted, false)
   AND EXISTS (
     SELECT 1 FROM public.approvals a
      WHERE a.entity_type = 'work_plan' AND a.entity_id = wp.id
        AND a.status IN ('대기', '진행중')
   );

SELECT public.cancel_open_approvals_for_entity('assessment_run', ar.id, '[문서삭제]')
  FROM public.assessment_runs ar
 WHERE COALESCE(ar.is_deleted, false)
   AND EXISTS (
     SELECT 1 FROM public.approvals a
      WHERE a.entity_type = 'assessment_run' AND a.entity_id = ar.id
        AND a.status IN ('대기', '진행중')
   );

-- Latest non-post (issue) approval version must be fully 승인.
CREATE OR REPLACE FUNCTION public.work_permit_issue_line_is_complete(_permit_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  WITH issue AS (
    SELECT a.approval_version, a.status
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND a.entity_id = _permit_id
       AND lower(COALESCE(a.position, '')) NOT IN ('closure_supervisor', 'closure_sm', 'extend_sm')
  ),
  latest AS (
    SELECT MAX(approval_version) AS v FROM issue
  )
  SELECT
    EXISTS (SELECT 1 FROM issue)
    AND NOT EXISTS (
      SELECT 1 FROM issue i, latest l
       WHERE i.approval_version = l.v
         AND i.status IN ('대기', '진행중', '반려')
    )
    AND EXISTS (
      SELECT 1 FROM issue i, latest l
       WHERE i.approval_version = l.v
         AND i.status = '승인'
    );
$fn$;

REVOKE ALL ON FUNCTION public.work_permit_issue_line_is_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.work_permit_issue_line_is_complete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_work_permit_edit_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- RPC skip still cannot issue unless this permit's own line is complete.
  -- Blocks work-plan cascade / any other skip-flag path for every company.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED')
     AND NOT public.work_permit_issue_line_is_complete(NEW.id) THEN
    RAISE EXCEPTION 'WORK_PERMIT_LINE_NOT_APPROVED: 결재선이 완료되지 않은 허가서는 발행할 수 없습니다.'
      USING ERRCODE = '42501';
  END IF;

  IF current_setting('app.skip_work_permit_edit_lock', true) = '1' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN (
       '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
       '검토대기', '검토완료', '결재중', '결재진행',
       '종료대기', '종료완료'
     ) THEN
    RAISE EXCEPTION 'WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(OLD.status, '') IN ('작성중', '반려', '임시저장', '검토대기', '검토완료') THEN
    RETURN NEW;
  END IF;

  IF NEW.form_data IS DISTINCT FROM OLD.form_data
     OR NEW.signatures IS DISTINCT FROM OLD.signatures
     OR NEW.work_description IS DISTINCT FROM OLD.work_description
     OR NEW.work_name IS DISTINCT FROM OLD.work_name
     OR NEW.location IS DISTINCT FROM OLD.location
     OR NEW.contractor_company IS DISTINCT FROM OLD.contractor_company
     OR NEW.personnel_count IS DISTINCT FROM OLD.personnel_count
     OR NEW.work_start_at IS DISTINCT FROM OLD.work_start_at
     OR NEW.work_end_at IS DISTINCT FROM OLD.work_end_at
     OR NEW.permit_type IS DISTINCT FROM OLD.permit_type
     OR NEW.permit_date IS DISTINCT FROM OLD.permit_date
     OR NEW.form_template_id IS DISTINCT FROM OLD.form_template_id
     OR NEW.linked_assessment_run_ids IS DISTINCT FROM OLD.linked_assessment_run_ids
     OR NEW.assessment_run_id IS DISTINCT FROM OLD.assessment_run_id
     OR NEW.work_plan_id IS DISTINCT FROM OLD.work_plan_id
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
