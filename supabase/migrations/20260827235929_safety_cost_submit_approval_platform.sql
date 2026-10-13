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
  v_first record;
  v_next record;
  v_pos text;
  v_now timestamptz := now();
  v_seen_keys text[] := ARRAY[]::text[];
  v_dedupe_key text;
  v_author uuid;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  IF _entity_type = 'safety_cost' THEN
    PERFORM public.assert_safety_cost_ready_to_submit(_entity_id);
  END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=v_now
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    IF COALESCE(v_step->>'position','') = '' OR NULLIF(v_step->>'user_id','') IS NULL THEN
      CONTINUE;
    END IF;
    v_dedupe_key := lower(COALESCE(v_step->>'position','')) || ':' || (v_step->>'user_id');
    IF v_dedupe_key = ANY(v_seen_keys) THEN
      CONTINUE;
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_dedupe_key);
    v_keys := array_append(v_keys, lower(COALESCE(v_step->>'position','')));

    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      '대기',
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted = 0 THEN RAISE EXCEPTION 'empty_steps_after_dedupe'; END IF;

  IF _entity_type = 'safety_cost' THEN
    IF NOT ('contractor_supervisor' = ANY (v_keys) OR 'contractor_pic' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_author';
    END IF;
    IF NOT ('contractor_site_director' = ANY (v_keys) OR 'site_director' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_site_director';
    END IF;
    IF NOT ('owner_sm' = ANY (v_keys) OR 'sm' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_owner_sm';
    END IF;
  END IF;

  IF _entity_type='assessment_run' THEN
    UPDATE public.assessment_runs
       SET status='결재진행', updated_at=v_now
     WHERE id=_entity_id AND status NOT IN ('승인완료');
  ELSIF _entity_type='work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits
       SET status='결재중',
           submitted_at=COALESCE(submitted_at, v_now),
           submitted_by=COALESCE(submitted_by, v_uid),
           updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','발행완료');
  ELSIF _entity_type='work_plan' THEN
    UPDATE public.work_plans
       SET status='결재중', updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','승인완료');
  ELSIF _entity_type='safety_cost' THEN
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.safety_cost_monthly_reports
       SET status='submitted',
           submitted_by=v_uid,
           submitted_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') IN ('draft', 'rejected');
    PERFORM public.snapshot_approval_document('safety_cost', _entity_id, v_next_version);
  END IF;

  SELECT * INTO v_first
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    v_pos := lower(COALESCE(v_first.position, ''));

    IF _entity_type = 'assessment_run'
       AND v_pos IN ('contractor_supervisor', 'contractor_pic')
    THEN
      SELECT COALESCE(author_user_id, created_by) INTO v_author
        FROM public.assessment_runs WHERE id = _entity_id;
      IF v_first.approver_id IS DISTINCT FROM v_uid
         OR (v_author IS NOT NULL AND v_first.approver_id IS DISTINCT FROM v_author)
      THEN
        UPDATE public.approvals
           SET status = '취소',
               comment = COALESCE(comment, '') || E'\n[상신거부] 담당자(시공)는 작성자 본인이어야 합니다.',
               updated_at = v_now
         WHERE entity_type = _entity_type
           AND entity_id = _entity_id
           AND approval_version = v_next_version;
        UPDATE public.assessment_runs
           SET status = '검증완료', updated_at = v_now
         WHERE id = _entity_id AND status = '결재진행';
        RAISE EXCEPTION 'submitter_step_must_be_author';
      END IF;
    END IF;

    IF v_pos IN ('contractor_supervisor', 'contractor_pic')
       AND (v_first.approver_id IS NULL OR v_first.approver_id = v_uid)
    THEN
      UPDATE public.approvals
         SET status='승인',
             approver_id=COALESCE(approver_id, v_uid),
             approved_at=v_now,
             comment=CASE
               WHEN COALESCE(comment,'') = '' THEN '[상신 완료]'
               ELSE comment
             END,
             updated_at=v_now
       WHERE id=v_first.id;

      IF _entity_type='work_permit' THEN
        PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
        UPDATE public.work_permits wp
           SET signatures = COALESCE(wp.signatures, '{}'::jsonb) || jsonb_build_object(
                 'contractor_pic', jsonb_build_object(
                   'name', COALESCE(v_first.approver_name, ''),
                   'signature', COALESCE(wp.signatures->'contractor_pic'->>'signature', ''),
                   'signed_at', v_now
                 )
               ),
               updated_at = v_now
         WHERE wp.id = _entity_id;
      END IF;

      SELECT * INTO v_next
        FROM public.approvals
       WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
         AND status='대기' AND step_order > v_first.step_order
       ORDER BY step_order ASC
       LIMIT 1;

      IF FOUND THEN
        UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_next.id;
      ELSE
        IF _entity_type='work_permit' THEN
          PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
          UPDATE public.work_permits
             SET status='승인', approved_at=v_now, approved_by=v_uid, updated_at=v_now
           WHERE id=_entity_id AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
        ELSIF _entity_type='work_plan' THEN
          UPDATE public.work_plans SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
        ELSIF _entity_type='assessment_run' THEN
          UPDATE public.assessment_runs SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
        ELSIF _entity_type='safety_cost' THEN
          PERFORM set_config('app.skip_document_edit_lock', '1', true);
          UPDATE public.safety_cost_monthly_reports
             SET status='approved', approved_by=v_uid, approved_at=v_now
           WHERE id=_entity_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_first.id;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_safety_cost_from_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending int;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'safety_cost' THEN RETURN NEW; END IF;
  PERFORM set_config('app.skip_document_edit_lock', '1', true);
  IF NEW.status = '반려' THEN
    UPDATE public.safety_cost_monthly_reports
       SET status = 'rejected'
     WHERE id = NEW.entity_id
       AND COALESCE(status, '') IN ('submitted', 'draft');
    RETURN NEW;
  END IF;
  IF NEW.status = '승인' THEN
    SELECT COUNT(*) INTO v_pending
      FROM public.approvals
     WHERE entity_type = 'safety_cost'
       AND entity_id = NEW.entity_id
       AND approval_version = NEW.approval_version
       AND status IN ('대기', '진행중');
    IF COALESCE(v_pending, 0) = 0 THEN
      UPDATE public.safety_cost_monthly_reports
         SET status = 'approved',
             approved_at = COALESCE(approved_at, now()),
             approved_by = COALESCE(approved_by, NEW.approver_id)
       WHERE id = NEW.entity_id
         AND COALESCE(status, '') IN ('submitted', 'draft');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_safety_cost_from_approvals ON public.approvals;
CREATE TRIGGER trg_safety_cost_from_approvals
  AFTER UPDATE OF status ON public.approvals
  FOR EACH ROW
  WHEN (NEW.entity_type = 'safety_cost')
  EXECUTE FUNCTION public.trg_safety_cost_from_approvals();

GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
