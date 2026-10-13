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
