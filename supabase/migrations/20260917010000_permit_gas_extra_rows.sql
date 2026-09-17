-- Allow optional 2~4회 gas result keys on issued/closure-pending permits.
-- Closure remains ungated. Existing 7 keys are unchanged.

CREATE OR REPLACE FUNCTION public.save_permit_gas_readings(
  _permit_id uuid,
  _readings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  patch jsonb := '{}'::jsonb;
  k text;
  allowed text[] := ARRAY[
    'gas_o2','gas_co2','gas_h2s','gas_co','gas_hc','gas_time','gas_measurer',
    'gas_o2_2','gas_co2_2','gas_h2s_2','gas_co_2','gas_hc_2',
    'gas_o2_3','gas_co2_3','gas_h2s_3','gas_co_3','gas_hc_3',
    'gas_o2_4','gas_co2_4','gas_h2s_4','gas_co_4','gas_hc_4'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;

  SELECT * INTO r FROM public.work_permits WHERE id = _permit_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  IF COALESCE(r.status, '') NOT IN ('승인', '발행완료', '종료대기') THEN
    RETURN jsonb_build_object('error', 'INVALID_STATUS', 'status', r.status);
  END IF;

  IF NOT public.is_project_member(v_uid, r.project_id) AND NOT public.is_master(v_uid) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  FOREACH k IN ARRAY allowed LOOP
    IF _readings ? k THEN
      patch := patch || jsonb_build_object(k, COALESCE(_readings->>k, ''));
    END IF;
  END LOOP;

  IF patch = '{}'::jsonb THEN
    RETURN jsonb_build_object('error', 'EMPTY_READINGS');
  END IF;

  PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
  UPDATE public.work_permits
     SET form_data = COALESCE(form_data, '{}'::jsonb) || patch,
         updated_at = now()
   WHERE id = _permit_id;

  RETURN jsonb_build_object('success', true, 'form_data', (SELECT form_data FROM public.work_permits WHERE id = _permit_id));
END;
$function$;

COMMENT ON FUNCTION public.save_permit_gas_readings(uuid, jsonb) IS
  'Gas-only write for issued/closure-pending permits. Extra 2~4회 keys optional; closure not gated.';

GRANT EXECUTE ON FUNCTION public.save_permit_gas_readings(uuid, jsonb) TO authenticated, service_role;
