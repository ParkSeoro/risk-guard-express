-- 작업취소 알람: 해당 문서 결재선(상신·연장·종료) approver 전원. 취소자 본인 제외.

CREATE OR REPLACE FUNCTION public.void_work_document(
  _entity_type text,
  _entity_id uuid,
  _reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := btrim(COALESCE(_reason, ''));
  v_project_id uuid;
  v_status text;
  v_voided_at timestamptz;
  v_is_deleted boolean;
  v_name text;
  v_label text;
  v_doc_title text;
  v_link text;
  v_title text;
  v_msg text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF v_reason = '' THEN
    RETURN jsonb_build_object('error', 'REASON_REQUIRED');
  END IF;
  IF _entity_type IS DISTINCT FROM 'work_permit' AND _entity_type IS DISTINCT FROM 'work_plan' THEN
    RETURN jsonb_build_object('error', 'INVALID_TYPE');
  END IF;

  IF _entity_type = 'work_permit' THEN
    SELECT project_id, status, voided_at, COALESCE(is_deleted, false)
      INTO v_project_id, v_status, v_voided_at, v_is_deleted
      FROM public.work_permits WHERE id = _entity_id;
  ELSE
    SELECT project_id, status, voided_at, COALESCE(is_deleted, false)
      INTO v_project_id, v_status, v_voided_at, v_is_deleted
      FROM public.work_plans WHERE id = _entity_id;
  END IF;

  IF v_project_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF v_is_deleted THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;
  IF v_voided_at IS NOT NULL OR v_status = '작업취소' THEN
    RETURN jsonb_build_object('error', 'ALREADY_VOIDED');
  END IF;
  IF v_status IS NULL OR v_status NOT IN (
    '결재중', '결재진행', '검토대기', '검토완료', '대기',
    '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
    '종료대기', 'CLOSURE_PENDING', '완료'
  ) THEN
    RETURN jsonb_build_object('error', 'NOT_VOIDABLE');
  END IF;

  IF NOT public.has_project_role(
    v_uid,
    v_project_id,
    ARRAY['project_admin']::public.project_role[]
  ) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT display_name INTO v_name FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  v_name := COALESCE(NULLIF(btrim(v_name), ''), '프로젝트 관리자');

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  PERFORM set_config('app.skip_document_edit_lock', '1', true);

  IF _entity_type = 'work_permit' THEN
    UPDATE public.work_permits
       SET status = '작업취소',
           voided_at = now(),
           voided_by = v_uid,
           voided_reason = v_reason,
           voided_by_name = v_name,
           updated_at = now()
     WHERE id = _entity_id;
    PERFORM public.cancel_open_approvals_for_entity('work_permit', _entity_id, '[작업취소]');
    SELECT COALESCE(NULLIF(work_name,''), NULLIF(work_description,''), '작업허가서')
      INTO v_doc_title FROM public.work_permits WHERE id = _entity_id;
    v_label := '작업허가서';
    v_link := '/work-permits/' || _entity_id::text;
  ELSE
    UPDATE public.work_plans
       SET status = '작업취소',
           voided_at = now(),
           voided_by = v_uid,
           voided_reason = v_reason,
           voided_by_name = v_name,
           updated_at = now()
     WHERE id = _entity_id;
    PERFORM public.cancel_open_approvals_for_entity('work_plan', _entity_id, '[작업취소]');
    SELECT COALESCE(NULLIF(title,''), '작업계획서')
      INTO v_doc_title FROM public.work_plans WHERE id = _entity_id;
    v_label := '작업계획서';
    v_link := '/work-plan/' || _entity_id::text;
  END IF;

  v_title := v_label || ' 작업 취소';
  v_msg := COALESCE(v_doc_title, v_label) || '이(가) 작업 취소되었습니다.'
        || E'\n사유: ' || v_reason
        || E'\n취소자: ' || v_name;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body,
    related_type, related_id, link, severity, is_read
  )
  SELECT DISTINCT a.approver_id, v_project_id, 'approval_result',
         v_title, v_msg, v_msg,
         _entity_type, _entity_id::text, v_link, 'warning', false
    FROM public.approvals a
   WHERE a.entity_type = _entity_type
     AND a.entity_id = _entity_id
     AND a.approver_id IS NOT NULL
     AND a.approver_id IS DISTINCT FROM v_uid;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.void_work_document(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_work_document(text, uuid, text) TO authenticated, service_role;
