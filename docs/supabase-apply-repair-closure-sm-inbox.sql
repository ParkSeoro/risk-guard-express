-- SafeNex: 관리감독자 작업완료 승인 후 발주처 SM 함에 안 뜨는 건 복구
-- Paste into Supabase SQL Editor and Run once.
-- Uses body dollar-quotes (SQL Editor-safe).
--
-- 증상: 허가서는 종료대기, 관리감독자는 완료 확인했는데 SM 전자결재함에 없음.
-- 원인: closure_sm 이 '대기'에 남음. 함은 '진행중'만 보여줌. 시공사 무관 공통.
-- 이 스크립트는 (1) 기존 건 승격 (2) 이후 감독 승인 시 자동 승격 트리거.

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

-- Returns how many SM rows were opened. 0 = none stuck (or already 진행중).
SELECT public.repair_stuck_permit_closure_sm() AS unstuck_sm_rows;
