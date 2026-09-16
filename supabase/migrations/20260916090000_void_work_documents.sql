-- 작업허가서·작업계획서 작업취소(void). 삭제·회수·종료완료와 구분.
-- 상신 스냅샷은 건드리지 않고 라이브 행 상태+도장 컬럼만 갱신한다.

ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_reason text,
  ADD COLUMN IF NOT EXISTS voided_by_name text;

ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_reason text,
  ADD COLUMN IF NOT EXISTS voided_by_name text;

COMMENT ON COLUMN public.work_permits.voided_at IS '작업취소 시각. 문서 삭제와 다름.';
COMMENT ON COLUMN public.work_plans.voided_at IS '작업취소 시각. 문서 삭제와 다름.';

CREATE OR REPLACE FUNCTION public.approval_entity_is_voided(_entity_type text, _entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN _entity_type = 'work_permit' THEN
      EXISTS (
        SELECT 1 FROM public.work_permits
         WHERE id = _entity_id
           AND (status = '작업취소' OR voided_at IS NOT NULL)
      )
    WHEN _entity_type = 'work_plan' THEN
      EXISTS (
        SELECT 1 FROM public.work_plans
         WHERE id = _entity_id
           AND (status = '작업취소' OR voided_at IS NOT NULL)
      )
    ELSE false
  END;
$fn$;

REVOKE ALL ON FUNCTION public.approval_entity_is_voided(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approval_entity_is_voided(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_block_voided_entity_approval_act()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF public.approval_entity_is_voided(NEW.entity_type, NEW.entity_id) THEN
    RAISE EXCEPTION 'ENTITY_VOIDED: 작업 취소된 문서는 결재할 수 없습니다.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_block_voided_entity_approval_insert ON public.approvals;
CREATE TRIGGER trg_block_voided_entity_approval_insert
BEFORE INSERT ON public.approvals
FOR EACH ROW
WHEN (NEW.entity_type IS NOT NULL)
EXECUTE FUNCTION public.trg_block_voided_entity_approval_act();

DROP TRIGGER IF EXISTS trg_block_voided_entity_approval_act ON public.approvals;
CREATE TRIGGER trg_block_voided_entity_approval_act
BEFORE UPDATE OF status ON public.approvals
FOR EACH ROW
WHEN (NEW.status IN ('승인', '반려') AND OLD.status = '진행중')
EXECUTE FUNCTION public.trg_block_voided_entity_approval_act();

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

  -- master 포함. SM/현장대리인/감리 제외 (is_project_admin 은 SM을 품으므로 쓰지 않음).
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
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.void_work_document(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_work_document(text, uuid, text) TO authenticated, service_role;

-- 대기함에서 작업취소 문서를 빼 둔다 (열린 결재는 RPC가 취소함).
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
           WHEN a.entity_type='work_plan' THEN wp.title
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan' THEN wp.start_date
           WHEN a.entity_type='work_permit' THEN per.permit_date
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN ar.start_date
           ELSE NULL END AS entity_date,
         CASE
           WHEN a.entity_type='work_permit' THEN COALESCE(NULLIF(per.contractor_company,''), a.company_name)
           WHEN a.entity_type='work_plan' THEN COALESCE(NULLIF(wpc.name,''), NULLIF(author_co.name,''), a.company_name, '')
           WHEN a.entity_type IN ('assessment_run', 'assessment_run_feedback') THEN COALESCE(NULLIF(author_co.name,''), a.company_name, '')
           ELSE COALESCE(a.company_name, '')
         END AS company_name,
         CASE WHEN a.entity_type='work_permit' THEN per.personnel_count ELSE NULL END AS personnel_count,
         a.approval_version,
         GREATEST(COALESCE(a.approval_version, 1) - 1, 0) AS resubmit_count,
         CASE WHEN a.entity_type='work_permit' THEN per.submitted_at ELSE NULL END AS submitted_at
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type IN ('assessment_run', 'assessment_run_feedback')
                                        AND ar.id = a.entity_id
    LEFT JOIN public.companies wpc
      ON a.entity_type='work_plan'
     AND wpc.id = wp.company_id
     AND COALESCE(wpc.is_deleted, false) = false
    LEFT JOIN LATERAL (
      SELECT c.name
      FROM public.project_members pm
      JOIN public.companies c
        ON c.id = pm.company_id
       AND COALESCE(c.is_deleted, false) = false
      WHERE a.entity_type IN ('work_plan', 'assessment_run', 'assessment_run_feedback')
        AND pm.project_id = a.project_id
        AND pm.user_id = CASE
          WHEN a.entity_type='work_plan' THEN COALESCE(wp.author_user_id, wp.created_by)
          ELSE COALESCE(ar.author_user_id, ar.created_by)
        END
      ORDER BY CASE WHEN pm.company_id IS NOT NULL THEN 0 ELSE 1 END
      LIMIT 1
    ) author_co ON true
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
     AND NOT public.approval_entity_is_deleted(a.entity_type, a.entity_id)
     AND NOT public.approval_entity_is_voided(a.entity_type, a.entity_id)
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

REVOKE ALL ON FUNCTION public.get_my_pending_entity_approvals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_pending_entity_approvals() TO authenticated, service_role;
