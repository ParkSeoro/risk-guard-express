-- Gas measurement is optional: do not block work-completion (closure) approvals.
-- Some sites do not perform gas checks; keep save_permit_gas_readings for optional entry.

CREATE OR REPLACE FUNCTION public.permit_gas_closure_gate(_permit_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Always allow; gas fields remain optional on the permit form.
  RETURN jsonb_build_object('ok', true, 'permit_id', _permit_id);
END;
$function$;

COMMENT ON FUNCTION public.permit_gas_closure_gate(uuid) IS
  'Gas measurement optional — always returns ok (closure/request no longer gated).';
