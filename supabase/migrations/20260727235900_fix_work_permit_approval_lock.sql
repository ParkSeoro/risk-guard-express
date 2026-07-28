-- ============================================================
-- Work permit approval finalize + edit lock (security harden)
-- ============================================================
-- 1) submit_approval: move work_permit/work_plan into '결재중'
-- 2) act_on_entity_approval: finalize parent when no incomplete steps remain
--    (fixes bool_and('승인') failing when same version has '취소' rows)
-- 3) Trigger: block form/content edits unless status is 작성중/반려
-- ============================================================

CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb,
  _reason text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=now()
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      CASE WHEN v_order=1 THEN '진행중' ELSE '대기' END,
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order+1;
    v_inserted := v_inserted+1;
  END LOOP;

  IF _entity_type='assessment_run' THEN
    BEGIN
      UPDATE public.assessment_runs
         SET status='결재진행', updated_at=now()
       WHERE id=_entity_id AND status NOT IN ('승인완료');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSIF _entity_type='work_permit' THEN
    UPDATE public.work_permits
       SET status='결재중',
           submitted_at=COALESCE(submitted_at, now()),
           submitted_by=COALESCE(submitted_by, v_uid),
           updated_at=now()
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','발행완료');
  ELSIF _entity_type='work_plan' THEN
    UPDATE public.work_plans
       SET status='결재중', updated_at=now()
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','승인완료');
  END IF;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _a record;
  _next record;
  _prior_pending integer;
  _now timestamptz := now();
  _all_done boolean;
  _plan_id uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;

  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_ACTIVE_STEP'); END IF;

  SELECT COUNT(*) INTO _prior_pending FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND step_order < _a.step_order
     AND status NOT IN ('승인');
  IF _prior_pending > 0 THEN
    RETURN jsonb_build_object('error','PRIOR_STEP_NOT_APPROVED');
  END IF;

  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''),
         approved_at=_now,
         updated_at=_now
   WHERE id=_approval_id;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='반려',
             rejection_reason=COALESCE(_comment,''),
             updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='rejected', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  -- Promote next waiting step
  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version
     AND status='대기'
     AND step_order>_a.step_order
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    RETURN jsonb_build_object('success', true, 'action','forwarded', 'next_step_order', _next.step_order);
  END IF;

  -- Finalize when no incomplete steps remain (대기/진행중).
  -- Do NOT require every historical/cancelled row to be '승인'.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type=_a.entity_type
       AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version
       AND status IN ('대기','진행중')
  ) INTO _all_done;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING id INTO _plan_id;
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','발행완료','반려') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','발행완료','반려');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits
         SET status='승인',
             approved_at=_now,
             approved_by=auth.uid(),
             updated_at=_now
       WHERE id=_a.entity_id;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='approved', updated_at=_now WHERE id=_a.entity_id;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', true);
  END IF;

  RETURN jsonb_build_object('success', true, 'action','approved', 'finalized', false);
END;
$function$;

-- Keep alias in sync
CREATE OR REPLACE FUNCTION public.act_on_approval(
  _approval_id uuid,
  _action text,
  _comment text DEFAULT ''::text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.act_on_entity_approval(_approval_id, _action, _comment);
$function$;

-- Server-side edit lock for work permits
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

  -- Editable only while drafting or after reject
  IF COALESCE(OLD.status, '') IN ('작성중', '반려') THEN
    RETURN NEW;
  END IF;

  -- Soft-delete / restore always allowed
  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  -- Block content mutations; allow status/approval metadata transitions (RPC)
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
     OR NEW.tbm_session_id IS DISTINCT FROM OLD.tbm_session_id
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_work_permit_edit_lock ON public.work_permits;
CREATE TRIGGER trg_work_permit_edit_lock
  BEFORE UPDATE ON public.work_permits
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_work_permit_edit_lock();

GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.act_on_approval(uuid, text, text) TO authenticated, service_role;
