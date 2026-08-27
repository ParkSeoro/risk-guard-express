-- 안관비: 금액 SSOT, 이관 트랜잭션, 보호구 수령확인, 전자결재 연결, submitted 잠금

-- ─────────────────────────────────────────────
-- 1) 합계 트리거 (삭제 행 제외)
-- ─────────────────────────────────────────────
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

-- ─────────────────────────────────────────────
-- 2) 보호구 SKU 키 + 재고
-- ─────────────────────────────────────────────
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

CREATE OR REPLACE FUNCTION public.issue_ppe_entry(
  _ledger_id uuid,
  _issued_at date,
  _worker_name text,
  _item_name text,
  _quantity numeric,
  _signature_data text DEFAULT '',
  _worker_id uuid DEFAULT NULL,
  _user_id uuid DEFAULT NULL,
  _recipient_role text DEFAULT 'worker',
  _specification text DEFAULT '',
  _maker text DEFAULT '',
  _channel text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_led record;
  v_qty numeric := abs(COALESCE(_quantity, 0));
  v_sig text := COALESCE(_signature_data, '');
  v_channel text;
  v_status text;
  v_sku uuid;
  v_bal numeric;
  v_entry uuid;
  v_mov uuid;
  v_notify uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF v_qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  IF COALESCE(trim(_worker_name), '') = '' OR COALESCE(trim(_item_name), '') = '' THEN
    RAISE EXCEPTION 'name_and_item_required';
  END IF;

  SELECT * INTO v_led FROM public.safety_cost_ppe_ledgers WHERE id = _ledger_id AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'ledger_not_found'; END IF;
  IF NOT public.can_access_safety_cost(auth.uid(), v_led.project_id, v_led.company_id, true) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_channel := COALESCE(NULLIF(_channel, ''), CASE WHEN v_sig <> '' THEN 'manual' ELSE 'app' END);
  v_status := CASE WHEN v_sig <> '' OR v_channel = 'legacy' THEN 'confirmed' ELSE 'pending' END;

  v_sku := public.ensure_ppe_sku(
    v_led.project_id, v_led.company_id, v_led.construction_id,
    _item_name, _specification, _maker, '개'
  );
  v_bal := public.ppe_sku_balance(v_sku);
  IF v_bal < v_qty THEN
    RAISE EXCEPTION 'insufficient_ppe_stock' USING HINT = format('재고 %s, 지급 %s', v_bal, v_qty);
  END IF;

  INSERT INTO public.safety_cost_ppe_ledger_entries (
    ledger_id, project_id, company_id, issued_at, worker_name, worker_id, user_id,
    recipient_role, item_name, specification, maker, quantity,
    signature_data, signed_at, receipt_status, receipt_channel, sort_order
  ) VALUES (
    _ledger_id, v_led.project_id, v_led.company_id, COALESCE(_issued_at, CURRENT_DATE),
    trim(_worker_name), _worker_id, _user_id, COALESCE(NULLIF(_recipient_role, ''), 'worker'),
    trim(_item_name), COALESCE(_specification, ''), COALESCE(_maker, ''), v_qty,
    v_sig, CASE WHEN v_status = 'confirmed' THEN now() ELSE NULL END,
    v_status, v_channel, 0
  ) RETURNING id INTO v_entry;

  IF v_status = 'confirmed' THEN
    INSERT INTO public.safety_cost_ppe_stock_movements (
      project_id, company_id, construction_id, sku_id, movement_type, quantity,
      movement_date, source_type, source_issuance_id, report_id, note, created_by
    ) VALUES (
      v_led.project_id, v_led.company_id, v_led.construction_id, v_sku, 'out', v_qty,
      COALESCE(_issued_at, CURRENT_DATE), 'issuance', v_entry, v_led.report_id,
      '지급: ' || trim(_worker_name), auth.uid()
    ) RETURNING id INTO v_mov;
    UPDATE public.safety_cost_ppe_ledger_entries SET stock_movement_id = v_mov WHERE id = v_entry;
  ELSIF v_status = 'pending' THEN
    v_notify := _user_id;
    IF v_notify IS NULL AND _worker_id IS NOT NULL THEN
      SELECT p.user_id INTO v_notify
        FROM public.workers w
        JOIN public.profiles p
          ON regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')
           = regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g')
       WHERE w.id = _worker_id
         AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g') <> ''
       LIMIT 1;
    END IF;
    IF v_notify IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, project_id, type, title, message, related_type, related_id, link, is_read)
      VALUES (
        v_notify, v_led.project_id, 'ppe_receipt',
        '보호구 수령확인',
        trim(_item_name) || ' 수령을 확인해 주세요.',
        'ppe_ledger_entry', v_entry::text,
        '/app/worker/ppe-receipt', false
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'entry_id', v_entry,
    'receipt_status', v_status,
    'stock_movement_id', v_mov
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_ppe_receipt(
  _entry_id uuid,
  _signature_data text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_e record;
  v_led record;
  v_sku uuid;
  v_bal numeric;
  v_mov uuid;
  v_now timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF COALESCE(_signature_data, '') = '' THEN RAISE EXCEPTION 'signature_required'; END IF;

  SELECT * INTO v_e FROM public.safety_cost_ppe_ledger_entries WHERE id = _entry_id AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'entry_not_found'; END IF;

  IF NOT public.ppe_recipient_is_self(_entry_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_e.receipt_status = 'cancelled' THEN RAISE EXCEPTION 'cancelled'; END IF;

  IF v_e.receipt_status = 'confirmed' AND COALESCE(v_e.signature_data, '') <> '' THEN
    RETURN jsonb_build_object(
      'ok', true, 'already_confirmed', true,
      'entry_id', v_e.id, 'signed_at', v_e.signed_at, 'stock_movement_id', v_e.stock_movement_id
    );
  END IF;

  SELECT * INTO v_led FROM public.safety_cost_ppe_ledgers WHERE id = v_e.ledger_id;

  IF v_e.stock_movement_id IS NULL THEN
    v_sku := public.ensure_ppe_sku(
      v_e.project_id, v_e.company_id, v_led.construction_id,
      v_e.item_name, v_e.specification, v_e.maker, '개'
    );
    v_bal := public.ppe_sku_balance(v_sku);
    IF v_bal < COALESCE(v_e.quantity, 1) THEN
      RAISE EXCEPTION 'insufficient_ppe_stock';
    END IF;
    INSERT INTO public.safety_cost_ppe_stock_movements (
      project_id, company_id, construction_id, sku_id, movement_type, quantity,
      movement_date, source_type, source_issuance_id, report_id, note, created_by
    ) VALUES (
      v_e.project_id, v_e.company_id, v_led.construction_id, v_sku, 'out', COALESCE(v_e.quantity, 1),
      COALESCE(v_e.issued_at, CURRENT_DATE), 'issuance', v_e.id, v_led.report_id,
      '수령확인: ' || v_e.worker_name, auth.uid()
    ) RETURNING id INTO v_mov;
  ELSE
    v_mov := v_e.stock_movement_id;
  END IF;

  UPDATE public.safety_cost_ppe_ledger_entries
     SET signature_data = _signature_data,
         signed_at = COALESCE(signed_at, v_now),
         receipt_status = 'confirmed',
         receipt_channel = CASE WHEN receipt_channel = 'manual' THEN receipt_channel ELSE 'app' END,
         stock_movement_id = COALESCE(stock_movement_id, v_mov),
         updated_at = v_now
   WHERE id = _entry_id;

  RETURN jsonb_build_object(
    'ok', true, 'already_confirmed', false,
    'entry_id', _entry_id, 'signed_at', v_now, 'stock_movement_id', v_mov
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_pending_ppe_receipts()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT regexp_replace(COALESCE(phone, ''), '\D', '', 'g') INTO v_phone
    FROM public.profiles WHERE user_id = auth.uid();
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issued_at DESC, x.created_at DESC)
    FROM (
      SELECT e.id, e.issued_at, e.worker_name, e.item_name, e.quantity, e.specification, e.maker,
             e.receipt_status, e.receipt_channel, e.project_id, e.company_id, e.created_at,
             l.site_label, l.construction_id, l.report_id
        FROM public.safety_cost_ppe_ledger_entries e
        JOIN public.safety_cost_ppe_ledgers l ON l.id = e.ledger_id
       WHERE COALESCE(e.is_deleted, false) = false
         AND e.receipt_status = 'pending'
         AND (
           e.user_id = auth.uid()
           OR (
             e.worker_id IS NOT NULL AND COALESCE(v_phone, '') <> '' AND EXISTS (
               SELECT 1 FROM public.workers w
                WHERE w.id = e.worker_id
                  AND regexp_replace(COALESCE(w.phone, ''), '\D', '', 'g') = v_phone
             )
           )
         )
    ) x
  ), '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ppe_normalize_item_key(text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_ppe_sku(uuid, uuid, uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ppe_sku_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.issue_ppe_entry(uuid, date, text, text, numeric, text, uuid, uuid, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_ppe_receipt(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_pending_ppe_receipts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ppe_recipient_is_self(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 3) 상신 게이트
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assert_safety_cost_ready_to_submit(_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
  _c record;
  _total numeric;
  _approved numeric;
  _warning int;
  _ppe_amt numeric;
  _ppe_signed int;
BEGIN
  SELECT * INTO _r FROM public.safety_cost_monthly_reports WHERE id = _report_id AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'report_not_found'; END IF;
  IF COALESCE(_r.status, 'draft') NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'report_not_draft';
  END IF;
  SELECT * INTO _c FROM public.safety_cost_constructions WHERE id = _r.construction_id;
  SELECT COALESCE(SUM(amount), 0),
         COUNT(*) FILTER (WHERE classification_status = 'warning'),
         COALESCE(SUM(amount) FILTER (WHERE category_code = '3'), 0)
    INTO _total, _warning, _ppe_amt
    FROM public.safety_cost_items
   WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false;
  IF _total <= 0 THEN RAISE EXCEPTION 'empty_report'; END IF;
  IF _warning > 0 THEN RAISE EXCEPTION 'unusable_items'; END IF;
  _approved := public.safety_cost_approved_cumulative(_r.construction_id, _report_id);
  IF COALESCE(_c.safety_cost_total, 0) > 0 AND _approved + _total > _c.safety_cost_total + 1 THEN
    RAISE EXCEPTION 'over_budget';
  END IF;
  IF _ppe_amt > 0 THEN
    SELECT COUNT(*) INTO _ppe_signed
      FROM public.safety_cost_ppe_ledger_entries e
      JOIN public.safety_cost_ppe_ledgers l ON l.id = e.ledger_id
     WHERE l.report_id = _report_id
       AND COALESCE(e.is_deleted, false) = false
       AND (COALESCE(e.signature_data, '') <> '' OR e.receipt_status = 'confirmed');
    IF COALESCE(_ppe_signed, 0) = 0 THEN RAISE EXCEPTION 'ppe_signature_required'; END IF;
  END IF;
  PERFORM public.validate_safety_cost_report(_report_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.assert_safety_cost_ready_to_submit(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 4) 이관 확정 RPC
-- ─────────────────────────────────────────────
ALTER TABLE public.safety_cost_import_batches
  ADD COLUMN IF NOT EXISTS budget_confirmed boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.commit_safety_cost_legacy_import(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b record;
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_month jsonb;
  v_item jsonb;
  v_iss jsonb;
  v_report_id uuid;
  v_item_id uuid;
  v_ledger_id uuid;
  v_entry_id uuid;
  v_sku uuid;
  v_mov uuid;
  v_month_key text;
  v_month_date date;
  v_line numeric;
  v_included int := 0;
  v_total numeric := 0;
  v_approved numeric;
  v_live uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT * INTO v_b FROM public.safety_cost_import_batches WHERE id = _batch_id AND COALESCE(is_deleted, false) = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'batch_not_found'; END IF;
  IF v_b.status = 'committed' THEN RAISE EXCEPTION 'already_committed'; END IF;
  IF NOT public.can_access_safety_cost(v_uid, v_b.project_id, v_b.company_id, true) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF COALESCE(v_b.budget_confirmed, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'budget_not_confirmed';
  END IF;

  FOR v_month IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_b.draft_payload->'months', '[]'::jsonb))
  LOOP
    IF COALESCE((v_month->>'included')::boolean, true) IS NOT TRUE THEN CONTINUE; END IF;
    v_month_key := left(COALESCE(v_month->>'report_month', ''), 7);
    IF v_month_key !~ '^\d{4}-\d{2}$' THEN RAISE EXCEPTION 'invalid_month'; END IF;
    v_month_date := (v_month_key || '-01')::date;
    SELECT id INTO v_live
      FROM public.safety_cost_monthly_reports
     WHERE construction_id = v_b.construction_id
       AND report_month = v_month_date
       AND COALESCE(is_deleted, false) = false
     LIMIT 1;
    IF v_live IS NOT NULL THEN
      RAISE EXCEPTION 'live_month_exists' USING HINT = v_month_key;
    END IF;
    v_line := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_month->'items', '[]'::jsonb)) LOOP
      v_line := v_line + COALESCE((v_item->>'amount')::numeric, 0);
    END LOOP;
    v_total := v_total + v_line;
    v_included := v_included + 1;
  END LOOP;

  IF v_included = 0 THEN RAISE EXCEPTION 'no_months'; END IF;
  v_approved := public.safety_cost_approved_cumulative(v_b.construction_id);
  IF EXISTS (
    SELECT 1 FROM public.safety_cost_constructions c
     WHERE c.id = v_b.construction_id
       AND COALESCE(c.safety_cost_total, 0) > 0
       AND v_approved + v_total > c.safety_cost_total + 1
  ) THEN
    RAISE EXCEPTION 'over_budget';
  END IF;

  FOR v_month IN
    SELECT value FROM jsonb_array_elements(COALESCE(v_b.draft_payload->'months', '[]'::jsonb))
  LOOP
    IF COALESCE((v_month->>'included')::boolean, true) IS NOT TRUE THEN CONTINUE; END IF;
    v_month_key := left(v_month->>'report_month', 7);
    v_month_date := (v_month_key || '-01')::date;
    v_line := 0;
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_month->'items', '[]'::jsonb)) LOOP
      v_line := v_line + COALESCE((v_item->>'amount')::numeric, 0);
    END LOOP;

    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    INSERT INTO public.safety_cost_monthly_reports (
      construction_id, project_id, company_id, report_month, title, status, report_total,
      source, import_batch_id, approved_at, approved_by, created_by
    ) VALUES (
      v_b.construction_id, v_b.project_id, v_b.company_id, v_month_date,
      COALESCE(NULLIF(v_month->>'title', ''), v_month_key || ' 산업안전보건관리비 사용내역서(이관)'),
      'approved', v_line, 'legacy_import', _batch_id, v_now, v_uid, v_uid
    ) RETURNING id INTO v_report_id;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_month->'items', '[]'::jsonb)) LOOP
      INSERT INTO public.safety_cost_items (
        report_id, construction_id, project_id, company_id,
        transaction_date, usage_date, category_code, category_name, item_name, specification, maker,
        quantity, unit, unit_price, supply_amount, vat_amount, amount, supplier_name,
        classification_status, ai_reason, legal_basis, created_by
      ) VALUES (
        v_report_id, v_b.construction_id, v_b.project_id, v_b.company_id,
        CASE
          WHEN COALESCE(v_item->>'transaction_date','') ~ '^\d{4}-\d{2}-\d{2}' THEN left(v_item->>'transaction_date', 10)::date
          WHEN COALESCE(v_item->>'transaction_date','') ~ '^\d{4}-\d{2}$' THEN (left(v_item->>'transaction_date', 7) || '-01')::date
          ELSE NULL
        END,
        CASE
          WHEN COALESCE(v_item->>'usage_date', v_item->>'transaction_date', '') ~ '^\d{4}-\d{2}-\d{2}' THEN left(COALESCE(v_item->>'usage_date', v_item->>'transaction_date'), 10)::date
          WHEN COALESCE(v_item->>'usage_date', v_item->>'transaction_date', '') ~ '^\d{4}-\d{2}$' THEN (left(COALESCE(v_item->>'usage_date', v_item->>'transaction_date'), 7) || '-01')::date
          ELSE NULL
        END,
        COALESCE(v_item->>'category_code', ''),
        COALESCE(v_item->>'category_name', ''),
        COALESCE(v_item->>'item_name', ''),
        COALESCE(v_item->>'specification', ''),
        COALESCE(v_item->>'maker', ''),
        COALESCE((v_item->>'quantity')::numeric, 1),
        COALESCE(NULLIF(v_item->>'unit', ''), '식'),
        COALESCE((v_item->>'unit_price')::numeric, 0),
        COALESCE((v_item->>'supply_amount')::numeric, (v_item->>'amount')::numeric, 0),
        COALESCE((v_item->>'vat_amount')::numeric, 0),
        COALESCE((v_item->>'amount')::numeric, 0),
        COALESCE(v_item->>'supplier_name', ''),
        COALESCE(NULLIF(v_item->>'classification_status', ''), 'review'),
        COALESCE(NULLIF(v_item->>'ai_reason', ''), '승인본 이관'),
        COALESCE(NULLIF(v_item->>'legal_basis', ''), '건설업 산업안전보건관리비 계상 및 사용기준'),
        v_uid
      ) RETURNING id INTO v_item_id;

      IF COALESCE(v_item->>'category_code', '') = '3' AND COALESCE((v_item->>'quantity')::numeric, 0) > 0 THEN
        v_sku := public.ensure_ppe_sku(
          v_b.project_id, v_b.company_id, v_b.construction_id,
          v_item->>'item_name', v_item->>'specification', v_item->>'maker',
          COALESCE(NULLIF(v_item->>'unit', ''), '개')
        );
        INSERT INTO public.safety_cost_ppe_stock_movements (
          project_id, company_id, construction_id, sku_id, movement_type, quantity,
          movement_date, source_type, source_item_id, import_batch_id, report_id, note, created_by
        ) VALUES (
          v_b.project_id, v_b.company_id, v_b.construction_id, v_sku, 'in',
          COALESCE((v_item->>'quantity')::numeric, 1),
          COALESCE(
            CASE
              WHEN COALESCE(v_item->>'transaction_date','') ~ '^\d{4}-\d{2}-\d{2}' THEN left(v_item->>'transaction_date', 10)::date
              ELSE NULL
            END,
            v_month_date
          ),
          'import', v_item_id, _batch_id, v_report_id, '승인본 이관 입고', v_uid
        );
      END IF;
    END LOOP;

    IF jsonb_array_length(COALESCE(v_month->'ppe_issuances', '[]'::jsonb)) > 0 THEN
      INSERT INTO public.safety_cost_ppe_ledgers (
        project_id, company_id, construction_id, report_id, site_label, notes, created_by
      ) VALUES (
        v_b.project_id, v_b.company_id, v_b.construction_id, v_report_id, '', '승인본 이관(스캔서명)', v_uid
      )
      ON CONFLICT (report_id) DO UPDATE SET notes = EXCLUDED.notes
      RETURNING id INTO v_ledger_id;

      FOR v_iss IN SELECT value FROM jsonb_array_elements(v_month->'ppe_issuances') LOOP
        v_sku := public.ensure_ppe_sku(
          v_b.project_id, v_b.company_id, v_b.construction_id,
          v_iss->>'item_name', '', '', '개'
        );
        IF public.ppe_sku_balance(v_sku) < COALESCE((v_iss->>'quantity')::numeric, 1) THEN
          RAISE EXCEPTION 'insufficient_ppe_stock' USING HINT = COALESCE(v_iss->>'item_name', '');
        END IF;
        INSERT INTO public.safety_cost_ppe_ledger_entries (
          ledger_id, project_id, company_id, issued_at, worker_name, item_name, quantity,
          signature_data, signed_at, receipt_status, receipt_channel
        ) VALUES (
          v_ledger_id, v_b.project_id, v_b.company_id,
          COALESCE(
            CASE
              WHEN COALESCE(v_iss->>'issued_at','') ~ '^\d{4}-\d{2}-\d{2}' THEN left(v_iss->>'issued_at', 10)::date
              ELSE NULL
            END,
            v_month_date
          ),
          COALESCE(v_iss->>'worker_name', ''),
          COALESCE(v_iss->>'item_name', ''),
          COALESCE((v_iss->>'quantity')::numeric, 1),
          COALESCE(NULLIF(v_iss->>'signature_note', ''), 'legacy-scan'),
          v_now, 'confirmed', 'legacy'
        ) RETURNING id INTO v_entry_id;
        INSERT INTO public.safety_cost_ppe_stock_movements (
          project_id, company_id, construction_id, sku_id, movement_type, quantity,
          movement_date, source_type, source_issuance_id, import_batch_id, report_id, note, created_by
        ) VALUES (
          v_b.project_id, v_b.company_id, v_b.construction_id, v_sku, 'out',
          COALESCE((v_iss->>'quantity')::numeric, 1),
          COALESCE(
            CASE
              WHEN COALESCE(v_iss->>'issued_at','') ~ '^\d{4}-\d{2}-\d{2}' THEN left(v_iss->>'issued_at', 10)::date
              ELSE NULL
            END,
            v_month_date
          ),
          'import', v_entry_id, _batch_id, v_report_id, '승인본 이관 지급출고', v_uid
        ) RETURNING id INTO v_mov;
        UPDATE public.safety_cost_ppe_ledger_entries SET stock_movement_id = v_mov WHERE id = v_entry_id;
      END LOOP;
    END IF;

    INSERT INTO public.safety_cost_evidence_files (
      report_id, construction_id, project_id, company_id, evidence_kind,
      file_name, file_path, file_url, mime_type, uploaded_by, category_code
    ) VALUES (
      v_report_id, v_b.construction_id, v_b.project_id, v_b.company_id, 'legacy_pack',
      v_b.source_file_name, v_b.source_file_path, v_b.source_file_url,
      COALESCE(NULLIF(v_b.source_mime_type, ''), 'application/pdf'), v_uid, ''
    );
  END LOOP;

  UPDATE public.safety_cost_import_batches
     SET status = 'committed',
         committed_at = v_now,
         committed_by = v_uid,
         updated_at = v_now
   WHERE id = _batch_id;

  INSERT INTO public.safety_cost_audit_logs (
    project_id, company_id, construction_id, action, target_type, target_id, after_data, reason, user_id
  ) VALUES (
    v_b.project_id, v_b.company_id, v_b.construction_id, '승인본 이관 확정',
    'safety_cost_import_batch', _batch_id,
    jsonb_build_object('month_count', v_included, 'total', v_total),
    'legacy_import', v_uid
  );

  RETURN jsonb_build_object('ok', true, 'month_count', v_included, 'total', v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.commit_safety_cost_legacy_import(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────
-- 5) submitted 잠금 + 월 소스 입고만 PPE 잠금
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_safety_cost_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _status text;
  _report_id uuid;
  _locked boolean := false;
BEGIN
  IF current_setting('app.skip_document_edit_lock', true) = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'safety_cost_monthly_reports' THEN
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') IN ('submitted', 'approved') THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         AND NEW.status IN ('approved', 'rejected', 'submitted', 'draft') THEN
        RETURN NEW;
      END IF;
      IF (to_jsonb(NEW) - ARRAY['updated_at', 'report_total', 'status', 'approved_by', 'approved_at', 'submitted_by', 'submitted_at'])
         IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['updated_at', 'report_total', 'status', 'approved_by', 'approved_at', 'submitted_by', 'submitted_at'])
      THEN
        RAISE EXCEPTION 'submitted_document_locked'
          USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 수정할 수 없습니다.';
      END IF;
    END IF;
    IF TG_OP = 'DELETE' AND COALESCE(OLD.status, '') IN ('submitted', 'approved') THEN
      RAISE EXCEPTION 'submitted_document_locked'
        USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 삭제할 수 없습니다.';
    END IF;
    RETURN COALESCE(NEW, OLD);
  END IF;

  _report_id := COALESCE(NEW.report_id, OLD.report_id);
  IF _report_id IS NOT NULL THEN
    SELECT status INTO _status FROM public.safety_cost_monthly_reports WHERE id = _report_id;
    _locked := COALESCE(_status, '') IN ('submitted', 'approved');
  END IF;

  IF TG_TABLE_NAME IN ('safety_cost_items', 'safety_cost_evidence_files') AND _locked THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 안전관리비 내역서는 수정할 수 없습니다.';
  END IF;

  IF TG_TABLE_NAME = 'safety_cost_ppe_stock_movements' AND _locked
     AND COALESCE(COALESCE(NEW.source_type, OLD.source_type), '') IN ('item', 'import') THEN
    RAISE EXCEPTION 'submitted_document_locked'
      USING ERRCODE = '42501', HINT = '상신·승인된 월의 보호구 입고 수불은 수정할 수 없습니다.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_lock_safety_cost_ppe_movements ON public.safety_cost_ppe_stock_movements;
CREATE TRIGGER trg_lock_safety_cost_ppe_movements
  BEFORE INSERT OR UPDATE OR DELETE ON public.safety_cost_ppe_stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_lock();

CREATE OR REPLACE FUNCTION public.enforce_safety_cost_budget_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_approved numeric;
  v_is_master boolean;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.safety_cost_total, 0) >= COALESCE(OLD.safety_cost_total, 0) THEN RETURN NEW; END IF;
  v_approved := public.safety_cost_approved_cumulative(NEW.id);
  IF NEW.safety_cost_total + 1 >= v_approved THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'master'
  ) INTO v_is_master;
  IF NOT COALESCE(v_is_master, false) THEN
    RAISE EXCEPTION 'budget_below_approved'
      USING ERRCODE = '42501', HINT = '승인 누계보다 계상액을 낮출 수 없습니다.';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_safety_cost_budget_floor ON public.safety_cost_constructions;
CREATE TRIGGER trg_safety_cost_budget_floor
  BEFORE UPDATE ON public.safety_cost_constructions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_safety_cost_budget_floor();

-- ─────────────────────────────────────────────
-- 6) 스냅샷
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.snapshot_approval_document(_entity_type text, _entity_id uuid, _version int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _payload jsonb := '{}'::jsonb;
  _rigging jsonb;
  _items jsonb;
BEGIN
  IF _entity_type = 'work_permit' THEN
    SELECT to_jsonb(p) - 'weather_snapshot' INTO _payload
      FROM public.work_permits p WHERE p.id = _entity_id;
  ELSIF _entity_type = 'work_plan' THEN
    SELECT to_jsonb(p) INTO _payload FROM public.work_plans p WHERE p.id = _entity_id;
    SELECT to_jsonb(r) INTO _rigging FROM public.rigging_plans r WHERE r.work_plan_id = _entity_id;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('rigging_plan', _rigging);
  ELSIF _entity_type = 'assessment_run' THEN
    SELECT to_jsonb(r) INTO _payload FROM public.assessment_runs r WHERE r.id = _entity_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at), '[]'::jsonb)
      INTO _items FROM public.risk_items i WHERE i.run_id = _entity_id;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('risk_items', _items);
  ELSIF _entity_type = 'safety_cost' THEN
    SELECT to_jsonb(r) INTO _payload FROM public.safety_cost_monthly_reports r WHERE r.id = _entity_id;
    SELECT COALESCE(jsonb_agg(to_jsonb(i) ORDER BY i.sort_order, i.created_at), '[]'::jsonb)
      INTO _items FROM public.safety_cost_items i
     WHERE i.report_id = _entity_id AND COALESCE(i.is_deleted, false) = false;
    _payload := COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('items', _items);
  ELSE
    RETURN;
  END IF;

  INSERT INTO public.document_content_snapshots (entity_type, entity_id, approval_version, payload, created_by)
  VALUES (_entity_type, _entity_id, COALESCE(_version, 1), COALESCE(_payload, '{}'::jsonb), auth.uid())
  ON CONFLICT (entity_type, entity_id, approval_version)
  DO UPDATE SET payload = EXCLUDED.payload, created_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_snapshot_on_approval_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.entity_type IN ('work_permit', 'work_plan', 'assessment_run', 'safety_cost')
     AND COALESCE(NEW.step_order, 1) = 1 THEN
    PERFORM public.snapshot_approval_document(NEW.entity_type, NEW.entity_id, NEW.approval_version);
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────
-- 7) submit_approval: 산안비 분기
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_approval(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb,
  _reason text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_next_version integer;
  v_step jsonb;
  v_order integer := 1;
  v_inserted integer := 0;
  v_first record;
  v_next record;
  v_pos text;
  v_now timestamptz := now();
  v_seen_keys text[] := ARRAY[]::text[];
  v_dedupe_key text;
  v_author uuid;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF jsonb_array_length(COALESCE(_steps,'[]'::jsonb))=0 THEN RAISE EXCEPTION 'empty_steps'; END IF;

  IF _entity_type = 'safety_cost' THEN
    PERFORM public.assert_safety_cost_ready_to_submit(_entity_id);
  END IF;

  UPDATE public.approvals
     SET status='취소',
         comment=COALESCE(comment,'')||CASE WHEN _reason IS NOT NULL THEN E'\n[재상신] '||_reason ELSE '' END,
         updated_at=v_now
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND status IN ('대기','진행중');

  SELECT COALESCE(MAX(approval_version),0)+1 INTO v_next_version
    FROM public.approvals WHERE entity_type=_entity_type AND entity_id=_entity_id;

  FOR v_step IN SELECT * FROM jsonb_array_elements(_steps) LOOP
    IF COALESCE(v_step->>'position','') = '' OR NULLIF(v_step->>'user_id','') IS NULL THEN
      CONTINUE;
    END IF;
    v_dedupe_key := lower(COALESCE(v_step->>'position','')) || ':' || (v_step->>'user_id');
    IF v_dedupe_key = ANY(v_seen_keys) THEN
      CONTINUE;
    END IF;
    v_seen_keys := array_append(v_seen_keys, v_dedupe_key);
    v_keys := array_append(v_keys, lower(COALESCE(v_step->>'position','')));

    INSERT INTO public.approvals(
      project_id, entity_type, entity_id, run_id, step, step_order, status, approval_version,
      approver_id, approver_name, position, company_id, company_name
    ) VALUES (
      _project_id, _entity_type, _entity_id,
      CASE WHEN _entity_type='assessment_run' THEN _entity_id ELSE NULL END,
      COALESCE(v_step->>'label','결재'), v_order,
      '대기',
      v_next_version,
      NULLIF(v_step->>'user_id','')::uuid,
      COALESCE(v_step->>'user_name',''),
      COALESCE(v_step->>'position',''),
      NULLIF(v_step->>'company_id','')::uuid,
      COALESCE(v_step->>'company_name','')
    );
    v_order := v_order + 1;
    v_inserted := v_inserted + 1;
  END LOOP;

  IF v_inserted = 0 THEN RAISE EXCEPTION 'empty_steps_after_dedupe'; END IF;

  IF _entity_type = 'safety_cost' THEN
    IF NOT ('contractor_supervisor' = ANY (v_keys) OR 'contractor_pic' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_author';
    END IF;
    IF NOT ('contractor_site_director' = ANY (v_keys) OR 'site_director' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_site_director';
    END IF;
    IF NOT ('owner_sm' = ANY (v_keys) OR 'sm' = ANY (v_keys)) THEN
      RAISE EXCEPTION 'safety_cost_requires_owner_sm';
    END IF;
  END IF;

  IF _entity_type='assessment_run' THEN
    UPDATE public.assessment_runs
       SET status='결재진행', updated_at=v_now
     WHERE id=_entity_id AND status NOT IN ('승인완료');
  ELSIF _entity_type='work_permit' THEN
    PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
    UPDATE public.work_permits
       SET status='결재중',
           submitted_at=COALESCE(submitted_at, v_now),
           submitted_by=COALESCE(submitted_by, v_uid),
           updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','발행완료');
  ELSIF _entity_type='work_plan' THEN
    UPDATE public.work_plans
       SET status='결재중', updated_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') NOT IN ('승인','승인완료');
  ELSIF _entity_type='safety_cost' THEN
    PERFORM set_config('app.skip_document_edit_lock', '1', true);
    UPDATE public.safety_cost_monthly_reports
       SET status='submitted',
           submitted_by=v_uid,
           submitted_at=v_now
     WHERE id=_entity_id
       AND COALESCE(status,'') IN ('draft', 'rejected');
    PERFORM public.snapshot_approval_document('safety_cost', _entity_id, v_next_version);
  END IF;

  SELECT * INTO v_first
    FROM public.approvals
   WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
   ORDER BY step_order ASC
   LIMIT 1;

  IF FOUND THEN
    v_pos := lower(COALESCE(v_first.position, ''));

    IF _entity_type = 'assessment_run'
       AND v_pos IN ('contractor_supervisor', 'contractor_pic')
    THEN
      SELECT COALESCE(author_user_id, created_by) INTO v_author
        FROM public.assessment_runs WHERE id = _entity_id;
      IF v_first.approver_id IS DISTINCT FROM v_uid
         OR (v_author IS NOT NULL AND v_first.approver_id IS DISTINCT FROM v_author)
      THEN
        UPDATE public.approvals
           SET status = '취소',
               comment = COALESCE(comment, '') || E'\n[상신거부] 담당자(시공)는 작성자 본인이어야 합니다.',
               updated_at = v_now
         WHERE entity_type = _entity_type
           AND entity_id = _entity_id
           AND approval_version = v_next_version;
        UPDATE public.assessment_runs
           SET status = '검증완료', updated_at = v_now
         WHERE id = _entity_id AND status = '결재진행';
        RAISE EXCEPTION 'submitter_step_must_be_author';
      END IF;
    END IF;

    IF v_pos IN ('contractor_supervisor', 'contractor_pic')
       AND (v_first.approver_id IS NULL OR v_first.approver_id = v_uid)
    THEN
      UPDATE public.approvals
         SET status='승인',
             approver_id=COALESCE(approver_id, v_uid),
             approved_at=v_now,
             comment=CASE
               WHEN COALESCE(comment,'') = '' THEN '[상신 완료]'
               ELSE comment
             END,
             updated_at=v_now
       WHERE id=v_first.id;

      IF _entity_type='work_permit' THEN
        PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
        UPDATE public.work_permits wp
           SET signatures = COALESCE(wp.signatures, '{}'::jsonb) || jsonb_build_object(
                 'contractor_pic', jsonb_build_object(
                   'name', COALESCE(v_first.approver_name, ''),
                   'signature', COALESCE(wp.signatures->'contractor_pic'->>'signature', ''),
                   'signed_at', v_now
                 )
               ),
               updated_at = v_now
         WHERE wp.id = _entity_id;
      END IF;

      SELECT * INTO v_next
        FROM public.approvals
       WHERE entity_type=_entity_type AND entity_id=_entity_id AND approval_version=v_next_version
         AND status='대기' AND step_order > v_first.step_order
       ORDER BY step_order ASC
       LIMIT 1;

      IF FOUND THEN
        UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_next.id;
      ELSE
        IF _entity_type='work_permit' THEN
          PERFORM set_config('app.skip_work_permit_edit_lock', '1', true);
          UPDATE public.work_permits
             SET status='승인', approved_at=v_now, approved_by=v_uid, updated_at=v_now
           WHERE id=_entity_id AND COALESCE(status,'') NOT IN ('종료대기','종료완료');
        ELSIF _entity_type='work_plan' THEN
          UPDATE public.work_plans SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
        ELSIF _entity_type='assessment_run' THEN
          UPDATE public.assessment_runs SET status='승인완료', updated_at=v_now WHERE id=_entity_id;
        ELSIF _entity_type='safety_cost' THEN
          PERFORM set_config('app.skip_document_edit_lock', '1', true);
          UPDATE public.safety_cost_monthly_reports
             SET status='approved', approved_by=v_uid, approved_at=v_now
           WHERE id=_entity_id;
        END IF;
      END IF;
    ELSE
      UPDATE public.approvals SET status='진행중', updated_at=v_now WHERE id=v_first.id;
    END IF;
  END IF;

  RETURN v_inserted;
END;
$function$;

-- 결재 최종/반려 시 월보 상태 (act_on_entity_approval 복사 없이)
CREATE OR REPLACE FUNCTION public.trg_safety_cost_from_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pending int;
BEGIN
  IF NEW.entity_type IS DISTINCT FROM 'safety_cost' THEN RETURN NEW; END IF;
  PERFORM set_config('app.skip_document_edit_lock', '1', true);
  IF NEW.status = '반려' THEN
    UPDATE public.safety_cost_monthly_reports
       SET status = 'rejected'
     WHERE id = NEW.entity_id
       AND COALESCE(status, '') IN ('submitted', 'draft');
    RETURN NEW;
  END IF;
  IF NEW.status = '승인' THEN
    SELECT COUNT(*) INTO v_pending
      FROM public.approvals
     WHERE entity_type = 'safety_cost'
       AND entity_id = NEW.entity_id
       AND approval_version = NEW.approval_version
       AND status IN ('대기', '진행중');
    IF COALESCE(v_pending, 0) = 0 THEN
      UPDATE public.safety_cost_monthly_reports
         SET status = 'approved',
             approved_at = COALESCE(approved_at, now()),
             approved_by = COALESCE(approved_by, NEW.approver_id)
       WHERE id = NEW.entity_id
         AND COALESCE(status, '') IN ('submitted', 'draft');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_safety_cost_from_approvals ON public.approvals;
CREATE TRIGGER trg_safety_cost_from_approvals
  AFTER UPDATE OF status ON public.approvals
  FOR EACH ROW
  WHEN (NEW.entity_type = 'safety_cost')
  EXECUTE FUNCTION public.trg_safety_cost_from_approvals();

GRANT EXECUTE ON FUNCTION public.submit_approval(text, uuid, uuid, uuid, jsonb, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
