-- When 관리감독자(closure_supervisor) has approved but 발주처 SM(closure_sm) is still
-- 대기, get_my_pending_entity_approvals (status=진행중 only) never shows it.
-- Cause: next-step forward used step_order on the same approval_version; equal/NULL
-- order or version mismatch left SM waiting. promote() also skipped 종료대기 rows
-- so visiting 전자결재 never repaired them. Affects every contractor, not one company.

CREATE OR REPLACE FUNCTION public.repair_stuck_permit_closure_sm()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  n integer := 0;
BEGIN
  WITH latest_sup AS (
    SELECT DISTINCT ON (a.entity_id)
           a.entity_id, a.approval_version, a.status
      FROM public.approvals a
     WHERE a.entity_type = 'work_permit'
       AND lower(COALESCE(a.position, '')) = 'closure_supervisor'
       AND a.status IN ('승인', '진행중', '대기')
     ORDER BY a.entity_id, a.approval_version DESC, a.approved_at DESC NULLS LAST, a.step_order DESC
  ),
  upd AS (
    UPDATE public.approvals sm
       SET status = '진행중', updated_at = now()
      FROM latest_sup ls
     WHERE sm.entity_type = 'work_permit'
       AND sm.entity_id = ls.entity_id
       AND lower(COALESCE(sm.position, '')) = 'closure_sm'
       AND sm.status = '대기'
       AND ls.status = '승인'
       AND (
         sm.approval_version IS NOT DISTINCT FROM ls.approval_version
         OR NOT EXISTS (
           SELECT 1 FROM public.approvals x
            WHERE x.entity_type = 'work_permit'
              AND x.entity_id = sm.entity_id
              AND lower(COALESCE(x.position, '')) = 'closure_sm'
              AND x.approval_version IS NOT DISTINCT FROM ls.approval_version
         )
       )
    RETURNING sm.id
  )
  SELECT COUNT(*)::integer INTO n FROM upd;
  RETURN n;
END;
$body$;

COMMENT ON FUNCTION public.repair_stuck_permit_closure_sm() IS
  '관리감독자 완료 확인(승인) 후 발주처 SM 종료 단계가 대기에 남은 건을 진행중으로 승격';

REVOKE ALL ON FUNCTION public.repair_stuck_permit_closure_sm() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repair_stuck_permit_closure_sm() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_activate_closure_sm_after_supervisor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  IF NEW.entity_type = 'work_permit'
     AND lower(COALESCE(NEW.position, '')) = 'closure_supervisor'
     AND NEW.status = '승인'
     AND COALESCE(OLD.status, '') IS DISTINCT FROM '승인' THEN
    UPDATE public.approvals
       SET status = '진행중', updated_at = now()
     WHERE entity_type = 'work_permit'
       AND entity_id = NEW.entity_id
       AND lower(COALESCE(position, '')) = 'closure_sm'
       AND status = '대기'
       AND (
         approval_version IS NOT DISTINCT FROM NEW.approval_version
         OR NOT EXISTS (
           SELECT 1 FROM public.approvals x
            WHERE x.entity_type = 'work_permit'
              AND x.entity_id = NEW.entity_id
              AND lower(COALESCE(x.position, '')) = 'closure_sm'
              AND x.approval_version IS NOT DISTINCT FROM NEW.approval_version
         )
       );
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_activate_closure_sm_after_supervisor ON public.approvals;
CREATE TRIGGER trg_activate_closure_sm_after_supervisor
AFTER UPDATE OF status ON public.approvals
FOR EACH ROW
EXECUTE FUNCTION public.trg_activate_closure_sm_after_supervisor();

-- Unstick existing rows (정엔지니어링 포함 전 시공사)
SELECT public.repair_stuck_permit_closure_sm();
