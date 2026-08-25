-- Patrol 회수→수정 unlock, RA submitter-step enforce, action status cleanup + RLS.

-- ============================================================
-- 1) withdraw_approval: safety_inspection 지원 (회수 후 in_progress → 잠금 해제)
-- ============================================================
CREATE OR REPLACE FUNCTION public.withdraw_approval(
  _entity_type text,
  _entity_id   uuid,
  _reason      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version integer;
  v_project uuid;
  v_creator uuid;
  v_has_decided boolean;
  v_has_reject boolean;
  v_now timestamptz := now();
  v_affected integer;
  v_is_admin boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error','UNAUTHENTICATED'); END IF;
  IF _entity_type NOT IN ('work_plan','work_permit','assessment_run','safety_inspection') THEN
    RETURN jsonb_build_object('error','INVALID_ENTITY_TYPE');
  END IF;

  SELECT a.approval_version, a.project_id
    INTO v_version, v_project
    FROM public.approvals a
   WHERE a.entity_type = _entity_type
     AND a.entity_id = _entity_id
   ORDER BY a.approval_version DESC NULLS LAST, a.created_at DESC NULLS LAST
   LIMIT 1;

  IF v_version IS NULL THEN
    RETURN jsonb_build_object('error','NO_APPROVAL');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '반려'
  ) INTO v_has_reject;

  IF v_has_reject THEN
    IF _entity_type = 'work_plan' THEN
      UPDATE public.work_plans SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'work_permit' THEN
      PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
      UPDATE public.work_permits SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'assessment_run' THEN
      UPDATE public.assessment_runs SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    ELSIF _entity_type = 'safety_inspection' THEN
      PERFORM set_config('app.skip_document_edit_lock', '1', true);
      UPDATE public.safety_inspections SET status = '반려', updated_at = v_now WHERE id = _entity_id;
    END IF;
    RETURN jsonb_build_object(
      'error', 'ALREADY_REJECTED',
      'healed', true,
      'message', '이미 반려된 결재입니다. 문서를 수정한 뒤 재상신하세요.'
    );
  END IF;

  -- 상신 자동승인은 회수 허용; 그 외 실결재 승인이 있으면 차단
  SELECT EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type AND entity_id = _entity_id
       AND approval_version = v_version
       AND status = '승인'
       AND lower(COALESCE(position, '')) NOT IN (
         'contractor_supervisor', 'contractor_pic', 'site_supervisor'
       )
  ) INTO v_has_decided;
  IF v_has_decided THEN
    RETURN jsonb_build_object('error','ALREADY_DECIDED');
  END IF;

  IF _entity_type = 'work_plan' THEN
    SELECT created_by INTO v_creator FROM public.work_plans WHERE id = _entity_id;
  ELSIF _entity_type = 'work_permit' THEN
    SELECT created_by INTO v_creator FROM public.work_permits WHERE id = _entity_id;
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT COALESCE(author_user_id, created_by) INTO v_creator
      FROM public.assessment_runs WHERE id = _entity_id;
  ELSIF _entity_type = 'safety_inspection' THEN
    SELECT COALESCE(created_by, inspector_id) INTO v_creator
      FROM public.safety_inspections WHERE id = _entity_id;
  END IF;

  SELECT public.is_master(v_uid)
      OR public.has_project_role(
           v_uid,
           v_project,
           ARRAY['project_admin', 'safety_manager', 'site_manager', 'site_supervisor']::public.project_role[]
         )
    INTO v_is_admin;

  IF v_creator IS DISTINCT FROM v_uid AND NOT v_is_admin THEN
    RETURN jsonb_build_object('error','NOT_SUBMITTER');
  END IF;

  UPDATE public.approvals
     SET status = '취소',
         comment = COALESCE(comment, '') ||
           CASE WHEN _reason IS NOT NULL AND _reason <> ''
                THEN E'\n[회수] ' || _reason
                ELSE E'\n[회수] 상신자에 의해 회수됨' END,
         updated_at = v_now
   WHERE entity_type = _entity_type
     AND entity_id = _entity_id
     AND approval_version = v_version
     AND status IN ('진행중', '대기', '승인');

  GET DIAGNOSTICS v_affected = ROW_COUNT;

  IF _entity_type = 'work_plan' THEN
    UPDATE public.work_plans SET status = '작성중', updated_at = v_now WHERE id = _entity_id;
  ELSIF _entity_type = 'work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits SET status = '작성중', updated_at = v_now WHERE id = _entity_id;
  ELSIF _entity_type = 'assessment_run' THEN
    UPDATE public.assessment_runs SET status = '검증완료', updated_at = v_now WHERE id = _entity_id;
  ELSIF _entity_type = 'safety_inspection' THEN
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.safety_inspections
       SET status = 'in_progress',
           updated_at = v_now
     WHERE id = _entity_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'withdrawn_steps', v_affected, 'version', v_version);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.withdraw_approval(text, uuid, text) TO authenticated, service_role;

-- ============================================================
-- 2) submit_approval: 담당자(시공) ≠ 상신자 불일치면 거부 (assessment_run)
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

-- ============================================================
-- 3) Heal: 멈춰 있는 상신 단계(진행중) → 자동 승인 후 다음 순번
-- ============================================================
DO $$
DECLARE
  r record;
  v_next record;
  v_now timestamptz := now();
BEGIN
  FOR r IN
    SELECT a.*
      FROM public.approvals a
     WHERE a.entity_type = 'assessment_run'
       AND a.status = '진행중'
       AND lower(COALESCE(a.position, '')) IN ('contractor_supervisor', 'contractor_pic')
  LOOP
    UPDATE public.approvals
       SET status = '승인',
           approved_at = COALESCE(approved_at, v_now),
           comment = CASE
             WHEN COALESCE(comment, '') = '' THEN '[상신 완료] (자동치유)'
             WHEN comment LIKE '%상신 완료%' THEN comment
             ELSE comment || E'\n[상신 완료] (자동치유)'
           END,
           updated_at = v_now
     WHERE id = r.id;

    SELECT * INTO v_next
      FROM public.approvals
     WHERE entity_type = r.entity_type
       AND entity_id = r.entity_id
       AND approval_version = r.approval_version
       AND status = '대기'
       AND step_order > r.step_order
     ORDER BY step_order ASC
     LIMIT 1;

    IF FOUND THEN
      UPDATE public.approvals SET status = '진행중', updated_at = v_now WHERE id = v_next.id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 4) 조치 상태 통일 + 삭제된 점검의 유령 조치 정리
-- ============================================================
UPDATE public.safety_inspection_actions
   SET status = 'done',
       updated_at = now()
 WHERE status = 'completed';

UPDATE public.safety_inspection_actions a
   SET status = 'done',
       updated_at = now()
  FROM public.safety_inspections s
 WHERE a.inspection_id = s.id
   AND s.is_deleted = true
   AND a.status IS DISTINCT FROM 'done';

-- ============================================================
-- 5) RLS: 조치 SELECT를 부모 점검 회사 스코프 + 미삭제에 맞춤
-- ============================================================
DROP POLICY IF EXISTS "Members can view insp actions" ON public.safety_inspection_actions;
DROP POLICY IF EXISTS "Company-scoped view: safety_inspection_actions" ON public.safety_inspection_actions;

CREATE POLICY "Company-scoped view: safety_inspection_actions"
  ON public.safety_inspection_actions
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1
        FROM public.safety_inspections s
       WHERE s.id = safety_inspection_actions.inspection_id
         AND COALESCE(s.is_deleted, false) = false
         AND public.can_access_company_data(auth.uid(), s.project_id, s.company_id)
    )
  );
