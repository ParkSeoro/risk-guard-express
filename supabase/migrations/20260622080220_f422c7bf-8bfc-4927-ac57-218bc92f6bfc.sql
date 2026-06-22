
-- Enable required extensions for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Public RPC: submit hazard survey response by token (anonymous allowed)
CREATE OR REPLACE FUNCTION public.submit_hazard_survey_response(
  _qr_token text,
  _worker_name text,
  _worker_phone text,
  _company_name text,
  _scores jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_survey record;
  v_total numeric := 0;
  v_risk text := 'low';
  v_ip_hash text;
  v_high_threshold numeric := 60;
  v_mid_threshold numeric := 30;
  v_score_val numeric;
  v_key text;
BEGIN
  IF _qr_token IS NULL OR length(_qr_token) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  END IF;
  IF _worker_name IS NULL OR length(trim(_worker_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED');
  END IF;

  SELECT * INTO v_survey
  FROM public.hazard_surveys
  WHERE qr_token = _qr_token
    AND COALESCE(is_active, true) = true
    AND COALESCE(is_deleted, false) = false
  LIMIT 1;

  IF v_survey.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SURVEY_NOT_FOUND_OR_CLOSED');
  END IF;

  -- Sum numeric scores
  FOR v_key IN SELECT jsonb_object_keys(COALESCE(_scores, '{}'::jsonb)) LOOP
    BEGIN
      v_score_val := (_scores -> v_key)::numeric;
      v_total := v_total + COALESCE(v_score_val, 0);
    EXCEPTION WHEN OTHERS THEN
      -- ignore non-numeric values
      NULL;
    END;
  END LOOP;

  v_risk := CASE
    WHEN v_total >= v_high_threshold THEN 'high'
    WHEN v_total >= v_mid_threshold THEN 'medium'
    ELSE 'low'
  END;

  v_ip_hash := encode(digest(coalesce(current_setting('request.headers', true), '') || _worker_phone, 'sha256'), 'hex');

  INSERT INTO public.hazard_survey_responses (
    survey_id, project_id, worker_name, worker_phone, company_name,
    scores, total_score, risk_level, ip_hash, created_at
  ) VALUES (
    v_survey.id, v_survey.project_id,
    trim(_worker_name), _worker_phone, _company_name,
    COALESCE(_scores, '{}'::jsonb), v_total, v_risk, v_ip_hash, now()
  );

  -- Update survey counters
  UPDATE public.hazard_surveys
     SET response_count = COALESCE(response_count, 0) + 1,
         high_risk_count = COALESCE(high_risk_count, 0) + CASE WHEN v_risk = 'high' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE id = v_survey.id;

  RETURN jsonb_build_object(
    'ok', true,
    'risk_level', v_risk,
    'total_score', v_total,
    'survey_title', v_survey.title
  );
END;
$$;

-- Allow anonymous and authenticated to call submit
GRANT EXECUTE ON FUNCTION public.submit_hazard_survey_response(text,text,text,text,jsonb) TO anon, authenticated, service_role;

-- Lookup function (anonymous-readable minimal info)
CREATE OR REPLACE FUNCTION public.get_hazard_survey_public(_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v record;
BEGIN
  SELECT id, type, title, survey_date, is_active
    INTO v
  FROM public.hazard_surveys
  WHERE qr_token = _qr_token
    AND COALESCE(is_deleted, false) = false
  LIMIT 1;

  IF v.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;
  IF COALESCE(v.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CLOSED');
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'type', v.type,
    'title', v.title,
    'survey_date', v.survey_date
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_hazard_survey_public(text) TO anon, authenticated, service_role;
