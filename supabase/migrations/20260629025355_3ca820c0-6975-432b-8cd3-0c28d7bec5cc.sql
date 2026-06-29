
CREATE OR REPLACE FUNCTION public.trg_assessment_run_approved_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _target_names text[];
BEGIN
  IF NEW.status = '승인완료' AND COALESCE(OLD.status,'') <> '승인완료' THEN
    SELECT array_agg(c.name) INTO _target_names
      FROM public.companies c
     WHERE NEW.target_company_ids IS NOT NULL
       AND c.id = ANY(NEW.target_company_ids);

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT wp.created_by, 'assessment_result',
      '위험성평가 승인 — 작업허가서 반영 필요',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/work-permits'
    FROM public.work_permits wp
    WHERE wp.project_id = NEW.project_id
      AND COALESCE(wp.is_deleted, false) = false
      AND wp.status IN ('진행중','검토중','대기')
      AND (NEW.target_company_ids IS NULL
           OR COALESCE(array_length(NEW.target_company_ids,1),0) = 0
           OR (_target_names IS NOT NULL AND wp.contractor_company = ANY(_target_names)))
      AND wp.created_by IS NOT NULL;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    SELECT DISTINCT ts.created_by, 'assessment_result',
      '위험성평가 승인 — TBM 브리핑 반영',
      COALESCE(NEW.period_label, '위험성평가') || ' 가 승인되었습니다.',
      '/tbm'
    FROM public.tbm_sessions ts
    WHERE ts.project_id = NEW.project_id
      AND COALESCE(ts.is_deleted, false) = false
      AND ts.is_active = true
      AND (NEW.target_company_ids IS NULL
           OR COALESCE(array_length(NEW.target_company_ids,1),0) = 0
           OR ts.company_id = ANY(NEW.target_company_ids))
      AND ts.created_by IS NOT NULL;
  END IF;
  RETURN NEW;
END; $function$;

UPDATE public.approvals
   SET entity_type = 'assessment_run',
       entity_id   = run_id,
       updated_at  = now()
 WHERE entity_type IS NULL
   AND run_id IS NOT NULL;

WITH latest AS (
  SELECT entity_id AS run_id, MAX(approval_version) AS v
    FROM public.approvals
   WHERE entity_type = 'assessment_run' AND entity_id IS NOT NULL
   GROUP BY entity_id
),
done AS (
  SELECT a.entity_id AS run_id
    FROM public.approvals a
    JOIN latest l ON l.run_id = a.entity_id AND l.v = a.approval_version
   WHERE a.entity_type = 'assessment_run'
   GROUP BY a.entity_id
  HAVING bool_and(a.status = '승인')
)
UPDATE public.assessment_runs r
   SET status = '승인완료', updated_at = now()
  FROM done d
 WHERE r.id = d.run_id
   AND r.status <> '승인완료';

CREATE OR REPLACE FUNCTION public.resync_assessment_run_status(_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _v int; _all_done boolean; _new_status text;
BEGIN
  SELECT MAX(approval_version) INTO _v
    FROM public.approvals
   WHERE entity_type='assessment_run' AND entity_id=_run_id;

  IF _v IS NULL THEN
    RETURN jsonb_build_object('changed', false, 'reason', 'no_approvals');
  END IF;

  SELECT bool_and(status='승인') INTO _all_done
    FROM public.approvals
   WHERE entity_type='assessment_run' AND entity_id=_run_id AND approval_version=_v;

  IF _all_done THEN _new_status := '승인완료';
  ELSIF EXISTS (
    SELECT 1 FROM public.approvals
     WHERE entity_type='assessment_run' AND entity_id=_run_id AND approval_version=_v AND status='반려'
  ) THEN _new_status := '보완중';
  ELSE _new_status := '결재진행';
  END IF;

  UPDATE public.assessment_runs SET status=_new_status, updated_at=now()
   WHERE id=_run_id AND status<>_new_status;

  RETURN jsonb_build_object('changed', true, 'status', _new_status, 'version', _v);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resync_assessment_run_status(uuid) TO authenticated;
