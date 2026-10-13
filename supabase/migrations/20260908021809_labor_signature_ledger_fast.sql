CREATE OR REPLACE FUNCTION public.list_worker_signature_ledger(_project_id uuid, _worker_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_from date := COALESCE(_from, CURRENT_DATE - 30); v_to date := COALESCE(_to, CURRENT_DATE);
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  PERFORM set_config('statement_timeout', '8000', true);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signed_at DESC NULLS LAST) FROM (
      SELECT a.id::text AS id, 'daily_ack'::text AS kind, '일일서약'::text AS kind_label, a.worker_id,
        COALESCE(a.worker_name, w.name) AS worker_name, w.company_name, a.signature_data, a.created_at AS signed_at,
        a.pledge_text_hash, a.work_summary AS detail, a.ack_date::text AS work_date
      FROM public.worker_daily_acks a LEFT JOIN public.workers w ON w.id = a.worker_id
      WHERE a.project_id = _project_id AND a.ack_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
      UNION ALL
      SELECT e.id::text, 'no_accident', '무재해 서약', e.worker_id, w.name, w.company_name, e.exit_signature_data,
        COALESCE(e.exit_at, e.entry_at), NULL, CASE WHEN e.no_accident_confirmed THEN '무재해 확인' ELSE '퇴근 서명' END,
        (e.entry_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.worker_entry_logs e JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND e.exit_signature_data IS NOT NULL
        AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR e.worker_id = _worker_id)
      UNION ALL
      SELECT p.id::text, 'tbm', 'TBM', p.worker_id, p.worker_name, p.company_name, p.signature_data, p.participated_at,
        NULL, 'TBM 참여', s.tbm_date::text
      FROM public.tbm_participations p JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
      WHERE s.project_id = _project_id AND COALESCE(s.is_deleted, false) = false AND s.tbm_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR p.worker_id = _worker_id)
      UNION ALL
      SELECT a.id::text, 'ra_share', '위험성평가 공유', a.worker_id, a.worker_name, a.company_name, a.signature_data,
        a.signed_at, NULL, a.source, (a.signed_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.assessment_run_share_acks a
      WHERE a.project_id = _project_id AND (a.signed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
    ) x
  ), '[]'::jsonb);
END;$$;
