-- 이관 확정: 승인본 파일이 없으면 월보에 빈 증빙 행을 만들지 않는다.

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
        classification_status, ai_reason, legal_basis,
        ocr_status, ocr_raw_text, ocr_confidence, created_by
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
        COALESCE(NULLIF(v_item->>'ocr_status', ''), 'ocr_raw'),
        COALESCE(v_item->>'ocr_raw_text', ''),
        CASE
          WHEN COALESCE(v_item->>'ocr_confidence','') ~ '^[0-9]+(\.[0-9]+)?$' THEN (v_item->>'ocr_confidence')::numeric
          ELSE NULL
        END,
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

    IF COALESCE(v_b.source_file_url, '') <> '' OR COALESCE(v_b.source_file_path, '') <> '' THEN
      INSERT INTO public.safety_cost_evidence_files (
        report_id, construction_id, project_id, company_id, evidence_kind,
        file_name, file_path, file_url, mime_type, uploaded_by, category_code
      ) VALUES (
        v_report_id, v_b.construction_id, v_b.project_id, v_b.company_id, 'legacy_pack',
        v_b.source_file_name, v_b.source_file_path, v_b.source_file_url,
        COALESCE(NULLIF(v_b.source_mime_type, ''), 'application/pdf'), v_uid, ''
      );
    END IF;
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
