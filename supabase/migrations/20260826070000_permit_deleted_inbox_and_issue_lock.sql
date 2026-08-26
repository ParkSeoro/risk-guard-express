-- Block deleted permits from staying on the approval line, hide them from
-- the inbox, and stop client UPDATE from issuing a rejected permit.

CREATE OR REPLACE FUNCTION public.approval_entity_is_deleted(_entity_type text, _entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN _entity_type = 'work_permit' THEN
      EXISTS (SELECT 1 FROM public.work_permits WHERE id = _entity_id AND COALESCE(is_deleted, false))
    WHEN _entity_type = 'work_plan' THEN
      EXISTS (SELECT 1 FROM public.work_plans WHERE id = _entity_id AND COALESCE(is_deleted, false))
    WHEN _entity_type = 'assessment_run' THEN
      EXISTS (SELECT 1 FROM public.assessment_runs WHERE id = _entity_id AND COALESCE(is_deleted, false))
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.cancel_open_approvals_for_entity(
  _entity_type text,
  _entity_id uuid,
  _note text DEFAULT '[문서삭제]'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  n integer := 0;
BEGIN
  UPDATE public.approvals
     SET status = '취소',
         comment = CASE
           WHEN COALESCE(comment, '') = '' THEN _note
           WHEN comment LIKE '%' || _note || '%' THEN comment
           ELSE comment || E'\n' || _note
         END,
         updated_at = now()
   WHERE entity_type = _entity_type
     AND entity_id = _entity_id
     AND status IN ('대기', '진행중');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_cancel_approvals_on_permit_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.is_deleted IS TRUE
     AND COALESCE(OLD.is_deleted, false) IS FALSE THEN
    PERFORM public.cancel_open_approvals_for_entity('work_permit', NEW.id, '[문서삭제]');
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cancel_approvals_on_permit_delete ON public.work_permits;
CREATE TRIGGER trg_cancel_approvals_on_permit_delete
AFTER UPDATE OF is_deleted ON public.work_permits
FOR EACH ROW
EXECUTE FUNCTION public.trg_cancel_approvals_on_permit_delete();

CREATE OR REPLACE FUNCTION public.trg_block_deleted_entity_approval_act()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.approval_entity_is_deleted(NEW.entity_type, NEW.entity_id) THEN
    RAISE EXCEPTION 'ENTITY_DELETED: 삭제된 문서는 결재할 수 없습니다.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_deleted_entity_approval_insert ON public.approvals;
CREATE TRIGGER trg_block_deleted_entity_approval_insert
BEFORE INSERT ON public.approvals
FOR EACH ROW
WHEN (NEW.entity_type IS NOT NULL)
EXECUTE FUNCTION public.trg_block_deleted_entity_approval_act();

DROP TRIGGER IF EXISTS trg_block_deleted_entity_approval_act ON public.approvals;
CREATE TRIGGER trg_block_deleted_entity_approval_act
BEFORE UPDATE OF status ON public.approvals
FOR EACH ROW
WHEN (NEW.status IN ('승인', '반려') AND OLD.status = '진행중')
EXECUTE FUNCTION public.trg_block_deleted_entity_approval_act();

-- Heal: leftover 진행중/대기 on already-deleted docs
SELECT public.cancel_open_approvals_for_entity('work_permit', wp.id, '[문서삭제]')
  FROM public.work_permits wp
 WHERE COALESCE(wp.is_deleted, false)
   AND EXISTS (
     SELECT 1 FROM public.approvals a
      WHERE a.entity_type = 'work_permit' AND a.entity_id = wp.id
        AND a.status IN ('대기', '진행중')
   );

-- Direct client UPDATE must not issue a 반려/작성중 permit
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
  IF current_setting('app.skip_work_permit_edit_lock', true) = '1' THEN
    RETURN NEW;
  END IF;

  -- Soft-delete / restore always allowed
  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  -- 승인/결재중 등 발행 파이프라인 상태는 결재 RPC만 허용
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN (
       '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
       '검토대기', '검토완료', '결재중', '결재진행',
       '종료대기', '종료완료'
     ) THEN
    RAISE EXCEPTION 'WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다.'
      USING ERRCODE = '42501';
  END IF;

  -- Editable only while drafting or after reject
  IF COALESCE(OLD.status, '') IN ('작성중', '반려') THEN
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

DROP FUNCTION IF EXISTS public.get_my_pending_entity_approvals();
CREATE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid,
  entity_type text,
  entity_id uuid,
  project_id uuid,
  step text,
  step_order integer,
  step_position text,
  created_at timestamp with time zone,
  entity_title text,
  entity_date date,
  company_name text,
  personnel_count integer,
  approval_version integer,
  resubmit_count integer,
  submitted_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.title
           WHEN a.entity_type='work_permit'    THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type='assessment_run' THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.start_date
           WHEN a.entity_type='work_permit'    THEN per.permit_date
           WHEN a.entity_type='assessment_run' THEN ar.start_date
           ELSE NULL END AS entity_date,
         CASE
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.contractor_company,''), a.company_name)
           WHEN a.entity_type='work_plan' THEN COALESCE(a.company_name, '')
           ELSE COALESCE(a.company_name, '')
         END AS company_name,
         CASE WHEN a.entity_type='work_permit' THEN per.personnel_count ELSE NULL END AS personnel_count,
         a.approval_version,
         GREATEST(COALESCE(a.approval_version, 1) - 1, 0) AS resubmit_count,
         CASE WHEN a.entity_type='work_permit' THEN per.submitted_at ELSE NULL END AS submitted_at
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type='assessment_run' AND ar.id  = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
     AND NOT public.approval_entity_is_deleted(a.entity_type, a.entity_id)
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

REVOKE ALL ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.approval_entity_is_deleted(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approval_entity_is_deleted(text, uuid) TO authenticated, service_role;

-- SECURITY DEFINER: do not let clients cancel arbitrary approval lines.
REVOKE ALL ON FUNCTION public.cancel_open_approvals_for_entity(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_open_approvals_for_entity(text, uuid, text) TO service_role;
