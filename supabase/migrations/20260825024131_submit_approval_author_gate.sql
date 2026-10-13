-- ============================================================
-- 2) submit_approval: 담당자(시공)가 상신자 불일치면 거부 (assessment_run)
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
  v_first record;
  v_next record;
  v_pos text;
  v_now timestamptz := now();
  v_seen_keys text[] := ARRAY[]::text[];
  v_dedupe_key text;
  v_author uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

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
  END IF;

  SELECT * INTO v_first
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    v_pos := lower(COALESCE(v_first.position, ''));

    -- 위평: 담당자(시공)는 법적 작성자(=상신자)여야 함. 타인 지정 시 상신 거부.
    IF _entity_type = 'assessment_run'
       AND v_pos IN ('contractor_supervisor', 'contractor_pic')
    THEN
      SELECT COALESCE(author_user_id, created_by) INTO v_author
        FROM public.assessment_runs WHERE id = _entity_id;
      IF v_first.approver_id IS DISTINCT FROM v_uid
         OR (v_author IS NOT NULL AND v_first.approver_id IS DISTINCT FROM v_author)
      THEN
        -- 방금 넣은 버전 취소 (부분 상신 잔존 방지)
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
        END IF;
      END IF;
    ELSE
      UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_first.id;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$function$;
