-- 목록 원클릭 상신이 프로젝트 공용 approval_lines(다른 회사 결재선)를
-- 문서에 복사하거나, 줄이 없으면 프로젝트 관리자를 넣지 못하게 한다.
-- 결재선은 상세 화면에서 작성자가 지정한 뒤 submit_approval / submit_approval_from_draft 로만 올라간다.

CREATE OR REPLACE FUNCTION public.submit_entity_for_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _entity_type NOT IN ('work_plan', 'work_permit') THEN
    RETURN jsonb_build_object('error', 'UNSUPPORTED_ENTITY');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type = _entity_type
       AND entity_id = _entity_id
       AND status IN ('대기', '진행중')
  ) THEN
    RETURN jsonb_build_object('error', 'ALREADY_SUBMITTED');
  END IF;

  RETURN jsonb_build_object(
    'error', 'NO_DESIGNATED_LINE',
    'message', '지정된 결재선이 없습니다. 상세 화면에서 결재선을 정한 뒤 상신하세요.'
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_entity_for_approval(text, uuid, uuid) TO authenticated;
