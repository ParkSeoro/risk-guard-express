
-- Track 4: Server-side idempotency for mobile mutations.

CREATE TABLE IF NOT EXISTS public.mobile_idempotency_keys (
  key uuid PRIMARY KEY,
  user_id uuid,
  action text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.mobile_idempotency_keys TO authenticated;
GRANT ALL ON public.mobile_idempotency_keys TO service_role;
ALTER TABLE public.mobile_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own keys read" ON public.mobile_idempotency_keys;
CREATE POLICY "own keys read" ON public.mobile_idempotency_keys
  FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "own keys insert" ON public.mobile_idempotency_keys;
CREATE POLICY "own keys insert" ON public.mobile_idempotency_keys
  FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_mobile_idempotency_created
  ON public.mobile_idempotency_keys (created_at DESC);

-- Try to claim a key. Returns (claimed bool, prior jsonb).
CREATE OR REPLACE FUNCTION public.claim_idempotency(_key uuid, _action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _prior jsonb;
BEGIN
  IF _key IS NULL THEN RETURN jsonb_build_object('claimed', true); END IF;
  INSERT INTO public.mobile_idempotency_keys (key, user_id, action)
  VALUES (_key, auth.uid(), _action)
  ON CONFLICT (key) DO NOTHING;
  IF FOUND THEN
    RETURN jsonb_build_object('claimed', true);
  END IF;
  SELECT response INTO _prior FROM public.mobile_idempotency_keys WHERE key = _key;
  RETURN jsonb_build_object('claimed', false, 'prior', _prior);
END; $$;
REVOKE EXECUTE ON FUNCTION public.claim_idempotency(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_idempotency(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_idempotency_response(_key uuid, _response jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.mobile_idempotency_keys SET response = _response WHERE key = _key;
$$;
REVOKE EXECUTE ON FUNCTION public.save_idempotency_response(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_idempotency_response(uuid, jsonb) TO authenticated, service_role;

-- Idempotency-aware QR check-in wrapper (keeps original signature working).
CREATE OR REPLACE FUNCTION public.company_qr_check_in_idem(
  _token text, _name text, _phone text, _action text, _signature text,
  _ra_confirmed boolean DEFAULT false, _edu_confirmed boolean DEFAULT false,
  _tbm_confirmed boolean DEFAULT false, _no_accident boolean DEFAULT false,
  _idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _claim jsonb; _result jsonb;
BEGIN
  IF _idempotency_key IS NOT NULL THEN
    _claim := public.claim_idempotency(_idempotency_key, 'company_qr_check_in');
    IF (_claim->>'claimed')::boolean = false THEN
      RETURN COALESCE(_claim->'prior', jsonb_build_object('success', true, 'replayed', true));
    END IF;
  END IF;
  _result := public.company_qr_check_in(_token, _name, _phone, _action, _signature,
    _ra_confirmed, _edu_confirmed, _tbm_confirmed, _no_accident);
  IF _idempotency_key IS NOT NULL THEN
    PERFORM public.save_idempotency_response(_idempotency_key, _result);
  END IF;
  RETURN _result;
END; $$;
REVOKE EXECUTE ON FUNCTION public.company_qr_check_in_idem(text,text,text,text,text,boolean,boolean,boolean,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_qr_check_in_idem(text,text,text,text,text,boolean,boolean,boolean,boolean,uuid) TO anon, authenticated, service_role;

-- Cleanup helper (retain 30 days).
CREATE OR REPLACE FUNCTION public.purge_old_idempotency_keys()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH d AS (DELETE FROM public.mobile_idempotency_keys
              WHERE created_at < now() - interval '30 days' RETURNING 1)
  SELECT count(*)::int FROM d;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_old_idempotency_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_idempotency_keys() TO service_role;
