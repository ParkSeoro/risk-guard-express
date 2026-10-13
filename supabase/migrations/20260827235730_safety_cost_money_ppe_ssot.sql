-- 안관비: 금액 SSOT, 이관 트랜잭션, 보호구 수령확인, 전자결재 연결, submitted 잠금

CREATE OR REPLACE FUNCTION public.recalc_safety_cost_report_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  rid uuid;
  tot numeric;
BEGIN
  rid := COALESCE(NEW.report_id, OLD.report_id);
  IF rid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT COALESCE(SUM(amount), 0) INTO tot
    FROM public.safety_cost_items
   WHERE report_id = rid
     AND COALESCE(is_deleted, false) = false;
  PERFORM set_config('app.skip_document_edit_lock', '1', true);
  UPDATE public.safety_cost_monthly_reports
     SET report_total = tot
   WHERE id = rid
     AND COALESCE(report_total, 0) IS DISTINCT FROM tot;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_recalc_sc_report_total ON public.safety_cost_items;
CREATE TRIGGER trg_recalc_sc_report_total
  AFTER INSERT OR UPDATE OF amount, is_deleted, report_id OR DELETE
  ON public.safety_cost_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_safety_cost_report_total();

CREATE OR REPLACE FUNCTION public.safety_cost_approved_cumulative(
  _construction_id uuid,
  _exclude_report_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(report_total), 0)
    FROM public.safety_cost_monthly_reports
   WHERE construction_id = _construction_id
     AND COALESCE(is_deleted, false) = false
     AND status = 'approved'
     AND (_exclude_report_id IS NULL OR id <> _exclude_report_id);
$function$;

CREATE OR REPLACE FUNCTION public.ppe_normalize_item_key(
  _item_name text,
  _specification text DEFAULT '',
  _maker text DEFAULT ''
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT NULLIF(
    concat_ws(
      '|',
      NULLIF(lower(regexp_replace(regexp_replace(normalize(COALESCE(_item_name, ''), NFKC), '[[:space:]]+', '', 'g'), '[()\[\]{}]', '', 'g')), ''),
      NULLIF(lower(regexp_replace(regexp_replace(normalize(COALESCE(_specification, ''), NFKC), '[[:space:]]+', '', 'g'), '[()\[\]{}]', '', 'g')), ''),
      NULLIF(lower(regexp_replace(regexp_replace(normalize(COALESCE(_maker, ''), NFKC), '[[:space:]]+', '', 'g'), '[()\[\]{}]', '', 'g')), '')
    ),
    ''
  );
$function$;

CREATE OR REPLACE FUNCTION public.ensure_ppe_sku(
  _project_id uuid,
  _company_id uuid,
  _construction_id uuid,
  _item_name text,
  _specification text DEFAULT '',
  _maker text DEFAULT '',
  _unit text DEFAULT '개'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_id uuid;
BEGIN
  v_key := COALESCE(public.ppe_normalize_item_key(_item_name, _specification, _maker), 'unknown');
  SELECT id INTO v_id
    FROM public.safety_cost_ppe_skus
   WHERE construction_id = _construction_id AND item_key = v_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.safety_cost_ppe_skus (
    project_id, company_id, construction_id, item_key, item_name, specification, maker, unit
  ) VALUES (
    _project_id, _company_id, _construction_id, v_key,
    COALESCE(_item_name, ''), COALESCE(_specification, ''), COALESCE(_maker, ''), COALESCE(_unit, '개')
  )
  ON CONFLICT (construction_id, item_key) DO UPDATE SET item_name = EXCLUDED.item_name
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ppe_sku_balance(_sku_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    CASE
      WHEN movement_type IN ('in', 'return', 'adjust') THEN quantity
      WHEN movement_type IN ('out', 'dispose') THEN -quantity
      ELSE 0
    END
  ), 0)
    FROM public.safety_cost_ppe_stock_movements
   WHERE sku_id = _sku_id
     AND COALESCE(is_deleted, false) = false;
$function$;

ALTER TABLE public.safety_cost_ppe_ledger_entries
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS recipient_role text NOT NULL DEFAULT 'worker',
  ADD COLUMN IF NOT EXISTS specification text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS maker text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS receipt_channel text NOT NULL DEFAULT 'manual';

UPDATE public.safety_cost_ppe_ledger_entries
   SET receipt_status = CASE WHEN COALESCE(signature_data, '') = '' THEN 'pending' ELSE 'confirmed' END
 WHERE receipt_status = 'confirmed'
   AND COALESCE(signature_data, '') = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ppe_entries_receipt_status_chk'
  ) THEN
    ALTER TABLE public.safety_cost_ppe_ledger_entries
      ADD CONSTRAINT ppe_entries_receipt_status_chk
      CHECK (receipt_status IN ('pending', 'confirmed', 'cancelled'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ppe_entries_receipt_channel_chk'
  ) THEN
    ALTER TABLE public.safety_cost_ppe_ledger_entries
      ADD CONSTRAINT ppe_entries_receipt_channel_chk
      CHECK (receipt_channel IN ('manual', 'app', 'legacy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ppe_entries_pending_user
  ON public.safety_cost_ppe_ledger_entries(user_id)
  WHERE COALESCE(is_deleted, false) = false AND receipt_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ppe_entries_pending_worker
  ON public.safety_cost_ppe_ledger_entries(worker_id)
  WHERE COALESCE(is_deleted, false) = false AND receipt_status = 'pending';

DROP POLICY IF EXISTS "ppe_entries_select_recipient" ON public.safety_cost_ppe_ledger_entries;
CREATE POLICY "ppe_entries_select_recipient" ON public.safety_cost_ppe_ledger_entries
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      worker_id IS NOT NULL AND EXISTS (
        SELECT 1
          FROM public.workers w
          JOIN public.profiles p ON p.user_id = auth.uid()
         WHERE w.id = worker_id
           AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g')
             = regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')
           AND regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g') <> ''
      )
    )
  );

CREATE OR REPLACE FUNCTION public.ppe_recipient_is_self(_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entry public.safety_cost_ppe_ledger_entries;
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT * INTO v_entry FROM public.safety_cost_ppe_ledger_entries WHERE id = _entry_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_entry.user_id IS NOT NULL AND v_entry.user_id = auth.uid() THEN RETURN true; END IF;
  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
    FROM public.profiles WHERE user_id = auth.uid();
  IF COALESCE(v_phone, '') = '' THEN RETURN false; END IF;
  IF v_entry.worker_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.workers w
     WHERE w.id = v_entry.worker_id
       AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g') = v_phone
  ) THEN RETURN true; END IF;
  RETURN false;
END;
$function$;
