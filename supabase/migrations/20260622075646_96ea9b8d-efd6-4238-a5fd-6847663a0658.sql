
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'projects','companies','risk_items','generated_batches',
    'safety_cost_monthly_reports','approval_route_templates'
  ]) LOOP
    EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
      ADD COLUMN IF NOT EXISTS deleted_by uuid,
      ADD COLUMN IF NOT EXISTS deleted_reason text', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%s_is_deleted ON public.%I(is_deleted)', t, t);
  END LOOP;
END $$;
