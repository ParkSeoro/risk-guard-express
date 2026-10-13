CREATE OR REPLACE FUNCTION public.list_worker_signature_ledger(_project_id uuid, _worker_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_from date := COALESCE(_from, CURRENT_DATE - 30); v_to date := COALESCE(_to, CURRENT_DATE);
BEGIN
  v_uid := public.labor_assert_project_read(_project_id);
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.signed_at DESC NULLS LAST) FROM (
      SELECT a.id::text AS id, 'daily_ack'::text AS kind, '일일서약'::text AS kind_label, a.worker_id,
        COALESCE(a.worker_name, w.name) AS worker_name, w.company_name, a.signature_data, a.created_at AS signed_at,
        a.pledge_text_hash, a.work_summary AS detail, a.ack_date::text AS work_date
      FROM public.worker_daily_acks a LEFT JOIN public.workers w ON w.id = a.worker_id
      WHERE a.project_id = _project_id AND a.ack_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))
      UNION ALL
      SELECT e.id::text, 'no_accident', '무재해 서약', e.worker_id, w.name, w.company_name, e.exit_signature_data,
        COALESCE(e.exit_at, e.entry_at), NULL, CASE WHEN e.no_accident_confirmed THEN '무재해 확인' ELSE '퇴근 서명' END,
        (e.entry_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.worker_entry_logs e JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND e.exit_signature_data IS NOT NULL
        AND (e.entry_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR e.worker_id = _worker_id)
        AND (public.is_master(v_uid) OR public.can_access_company_data(v_uid, _project_id, w.company_id))
      UNION ALL
      SELECT p.id::text, 'tbm', 'TBM', p.worker_id, p.worker_name, p.company_name, p.signature_data, p.participated_at,
        NULL, 'TBM 참여', s.tbm_date::text
      FROM public.tbm_participations p JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
      LEFT JOIN public.workers w ON w.id = p.worker_id
      WHERE s.project_id = _project_id AND COALESCE(s.is_deleted, false) = false AND s.tbm_date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR p.worker_id = _worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))
      UNION ALL
      SELECT a.id::text, 'ra_share', '위험성평가 공유', a.worker_id, a.worker_name, a.company_name, a.signature_data,
        a.signed_at, NULL, a.source, (a.signed_at AT TIME ZONE 'Asia/Seoul')::date::text
      FROM public.assessment_run_share_acks a LEFT JOIN public.workers w ON w.id = a.worker_id
      WHERE a.project_id = _project_id AND (a.signed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR a.worker_id = _worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))
      UNION ALL
      SELECT e.id::text, 'ppe', '보호구 수령', e.worker_id, e.worker_name, NULL, e.signature_data, e.signed_at,
        NULL, e.item_name, COALESCE(e.issued_at, (e.signed_at AT TIME ZONE 'Asia/Seoul')::date)::text
      FROM public.safety_cost_ppe_ledger_entries e LEFT JOIN public.workers w ON w.id = e.worker_id
      WHERE e.project_id = _project_id AND COALESCE(e.is_deleted, false) = false AND e.signature_data IS NOT NULL
        AND COALESCE(e.issued_at, (e.signed_at AT TIME ZONE 'Asia/Seoul')::date) BETWEEN v_from AND v_to
        AND (_worker_id IS NULL OR e.worker_id = _worker_id)
        AND (public.is_master(v_uid) OR w.id IS NULL OR public.can_access_company_data(v_uid, _project_id, w.company_id))
    ) x
  ), '[]'::jsonb);
END;$$;

CREATE OR REPLACE FUNCTION public.correct_worker_entry_log(_entry_log_id uuid, _entry_at timestamptz, _exit_at timestamptz, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_e public.worker_entry_logs%ROWTYPE; v_company uuid; v_corr uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF COALESCE(trim(_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  IF _entry_at IS NULL THEN RAISE EXCEPTION 'entry_required'; END IF;
  IF _exit_at IS NOT NULL AND _exit_at < _entry_at THEN RAISE EXCEPTION 'invalid_range'; END IF;
  SELECT * INTO v_e FROM public.worker_entry_logs WHERE id = _entry_log_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;
  SELECT company_id INTO v_company FROM public.workers WHERE id = v_e.worker_id;
  IF NOT (public.is_master(v_uid) OR public.can_write_company_data(v_uid, v_e.project_id, v_company)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO public.worker_entry_corrections (project_id, entry_log_id, worker_id, before_entry_at, before_exit_at, after_entry_at, after_exit_at, reason, corrected_by)
  VALUES (v_e.project_id, v_e.id, v_e.worker_id, v_e.entry_at, v_e.exit_at, _entry_at, _exit_at, trim(_reason), v_uid) RETURNING id INTO v_corr;
  UPDATE public.worker_entry_logs SET entry_at = _entry_at, exit_at = _exit_at WHERE id = v_e.id;
  RETURN jsonb_build_object('ok', true, 'correction_id', v_corr, 'entry_log_id', v_e.id, 'entry_at', _entry_at, 'exit_at', _exit_at);
END;$$;

CREATE OR REPLACE FUNCTION public.sync_worker_profile_identity(_worker_id uuid, _name text, _phone text, _job_type text, _birth_date date, _hire_date date, _emergency_name text, _emergency_phone text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_w public.workers%ROWTYPE; v_phone text; v_old_digits text; v_new_digits text; v_updated int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_w FROM public.workers WHERE id = _worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_not_found'; END IF;
  IF NOT (public.is_master(v_uid) OR public.can_write_company_data(v_uid, v_w.project_id, v_w.company_id)) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_phone := COALESCE(NULLIF(trim(_phone), ''), v_w.phone);
  v_old_digits := regexp_replace(COALESCE(v_w.phone, ''), '\D', '', 'g');
  v_new_digits := regexp_replace(COALESCE(v_phone, ''), '\D', '', 'g');
  UPDATE public.workers SET name = COALESCE(NULLIF(trim(_name), ''), name), phone = v_phone,
    job_type = COALESCE(NULLIF(trim(_job_type), ''), job_type), birth_date = COALESCE(_birth_date, birth_date),
    hire_date = COALESCE(_hire_date, hire_date), emergency_name = NULLIF(trim(COALESCE(_emergency_name, '')), ''),
    emergency_phone = NULLIF(trim(COALESCE(_emergency_phone, '')), ''), updated_at = now() WHERE id = _worker_id;
  UPDATE public.profiles p SET display_name = COALESCE(NULLIF(trim(_name), ''), p.display_name),
    phone = CASE WHEN v_new_digits <> '' THEN v_phone ELSE p.phone END
  WHERE regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') IN (v_old_digits, v_new_digits) AND COALESCE(v_old_digits, '') <> '';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'worker_id', _worker_id, 'profiles_updated', v_updated);
END;$$;

REVOKE ALL ON FUNCTION public.list_worker_signature_ledger(uuid, uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.correct_worker_entry_log(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_worker_profile_identity(uuid, text, text, text, date, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_worker_signature_ledger(uuid, uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_worker_entry_log(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_worker_profile_identity(uuid, text, text, text, date, date, text, text) TO authenticated, service_role;
