-- 상신/승인 문서 하드락: 본문 컬럼 보강, 위성 테이블 잠금, 상신 스냅샷.
-- 작업허가서 인원명단(work_permit_workers)은 발행 후에도 수정 가능 — 잠그지 않음.

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

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN (
       '승인', '승인완료', '발행완료', 'approved', 'ISSUED', 'APPROVED',
       '검토대기', '검토완료', '결재중', '결재진행',
       '종료대기', '종료완료'
     ) THEN
    RAISE EXCEPTION 'WORK_PERMIT_APPROVAL_RPC_REQUIRED: 허가서 승인은 결재선으로만 처리할 수 있습니다.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(OLD.status, '') IN ('작성중', '반려', '임시저장') THEN
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
     OR NEW.permit_kinds IS DISTINCT FROM OLD.permit_kinds
     OR NEW.permit_date IS DISTINCT FROM OLD.permit_date
     OR NEW.form_template_id IS DISTINCT FROM OLD.form_template_id
     OR NEW.linked_assessment_run_ids IS DISTINCT FROM OLD.linked_assessment_run_ids
     OR NEW.assessment_run_id IS DISTINCT FROM OLD.assessment_run_id
     OR NEW.work_plan_id IS DISTINCT FROM OLD.work_plan_id
     OR NEW.ai_briefing IS DISTINCT FROM OLD.ai_briefing
     OR NEW.weather_snapshot IS DISTINCT FROM OLD.weather_snapshot
     OR NEW.extension_until IS DISTINCT FROM OLD.extension_until
  THEN
    RAISE EXCEPTION 'WORK_PERMIT_LOCKED: 결재 진행중/완료 문서는 수정할 수 없습니다. (status=%)', OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
