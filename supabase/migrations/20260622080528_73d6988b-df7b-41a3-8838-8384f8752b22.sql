
ALTER TABLE public.risk_items
  ADD COLUMN IF NOT EXISTS auto_adjust_reason text;

CREATE OR REPLACE FUNCTION public.apply_env_exceedance_to_risk(_measurement_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factor_id uuid;
  v_project_id uuid;
  v_exceeded boolean;
  v_updated int := 0;
BEGIN
  SELECT factor_id, project_id, COALESCE(is_exceeded, false)
    INTO v_factor_id, v_project_id, v_exceeded
  FROM public.work_env_measurements
  WHERE id = _measurement_id AND COALESCE(is_deleted,false) = false;

  IF v_factor_id IS NULL OR v_exceeded = false THEN
    RETURN 0;
  END IF;

  UPDATE public.risk_items ri
     SET severity = LEAST(COALESCE(ri.severity,1) + 1, 3),
         risk_score = LEAST(COALESCE(ri.severity,1) + 1, 3) * COALESCE(ri.probability,1),
         auto_adjust_reason = COALESCE(ri.auto_adjust_reason,'') ||
           CASE WHEN ri.auto_adjust_reason IS NULL OR ri.auto_adjust_reason = '' THEN '' ELSE E'\n' END ||
           '[자동] 작업환경측정 노출기준 초과로 강도 상향 (' || now()::date || ')',
         updated_at = now()
   WHERE v_factor_id = ANY(COALESCE(ri.linked_env_factor_ids, ARRAY[]::uuid[]))
     AND COALESCE(ri.is_deleted,false) = false
     AND (v_project_id IS NULL OR ri.project_id = v_project_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;
