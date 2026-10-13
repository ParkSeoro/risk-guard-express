CREATE OR REPLACE FUNCTION public.notify_assessment_run_share(_run public.assessment_runs)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _n int := 0;
  _title text;
  _body text;
  _notice_id uuid;
  _summary text;
BEGIN
  IF _run.id IS NULL OR _run.status IS DISTINCT FROM '승인완료' THEN
    RETURN 0;
  END IF;

  _summary := public.assessment_share_summary(_run.id);
  _title := COALESCE(NULLIF(_run.period_label, ''), '위험성평가') || ' 승인 · 결과 공유';
  _body := COALESCE(NULLIF(_run.period_label, ''), '위험성평가')
        || '가 승인되었습니다. 내용을 확인하고 서명해 주세요.'
        || E'\n\n' || _summary;

  SELECT id INTO _notice_id FROM public.assessment_notices WHERE run_id = _run.id LIMIT 1;
  IF _notice_id IS NULL THEN
    INSERT INTO public.assessment_notices (
      project_id, run_id, title, body, posted_at, created_by
    ) VALUES (
      _run.project_id, _run.id, _title, _body, now(), _run.created_by
    )
    RETURNING id INTO _notice_id;
  END IF;

  INSERT INTO public.notifications (
    user_id, project_id, type, title, message, body, link,
    related_type, related_id, severity, is_read, created_at
  )
  SELECT DISTINCT r.user_id, _run.project_id, 'assessment_share', _title, _body, _body,
         '/assessment-run/' || _run.id::text,
         'assessment_run', _run.id::text, 'high', false, now()
    FROM (
      SELECT pm.user_id
        FROM public.project_members pm
        JOIN public.profiles pr ON pr.user_id = pm.user_id
       WHERE pm.project_id = _run.project_id
         AND pm.user_id IS NOT NULL
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _run.target_company_ids,
               CASE WHEN pm.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[pm.company_id] END
             )
      UNION
      SELECT pr.user_id
        FROM public.workers w
        JOIN public.profiles pr
          ON public.normalize_phone_digits(COALESCE(pr.phone, '')) <> ''
         AND public.normalize_phone_digits(pr.phone) = public.normalize_phone_digits(w.phone)
       WHERE w.project_id = _run.project_id
         AND COALESCE(w.is_active, true) = true
         AND COALESCE(pr.account_status, 'active') = 'active'
         AND public.assessment_run_applies_to_companies(
               _run.target_company_ids,
               CASE WHEN w.company_id IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[w.company_id] END
             )
    ) r
   WHERE r.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = r.user_id
          AND n.type = 'assessment_share'
          AND n.related_id = _run.id::text
          AND n.created_at > now() - interval '1 day'
     );

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_assessment_run_share(public.assessment_runs) TO service_role;
