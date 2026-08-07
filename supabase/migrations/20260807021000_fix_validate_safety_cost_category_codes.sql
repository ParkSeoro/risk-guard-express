-- 산안비 검증 RPC: 현재 비목 코드(1~9)와 상태값(usable/warning/review)에 맞게 교정
-- 레거시 personnel/edu/ppe 코드도 하위호환으로 유지

CREATE OR REPLACE FUNCTION public.validate_safety_cost_report(_report_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _r record;
  _violations int := 0;
  _total numeric := 0;
  _personnel numeric := 0;
  _education numeric := 0;
  _ppe numeric := 0;
  _warning_count int := 0;
  _review_count int := 0;
  _missing_evidence int := 0;
BEGIN
  SELECT * INTO _r FROM public.safety_cost_monthly_reports WHERE id = _report_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'NOT_FOUND');
  END IF;

  -- 접근 권한: 보고서 company 스코프
  IF NOT public.can_access_safety_cost(auth.uid(), _r.project_id, _r.company_id, false) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  DELETE FROM public.safety_cost_violations WHERE report_id = _report_id;

  SELECT COALESCE(SUM(amount), 0) INTO _total
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false;

  -- 1번·8번 = 인건비성 (현장 안전·보건관리자 + 본사 전담조직)
  SELECT COALESCE(SUM(amount), 0) INTO _personnel
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false
    AND (
      category_code IN ('1', '8')
      OR category_code ILIKE '%personnel%'
      OR category_name ILIKE '%인건%'
      OR category_name ILIKE '%안전관리자%'
      OR category_name ILIKE '%보건관리자%'
      OR category_name ILIKE '%본사 전담%'
    );

  -- 5번 = 교육비
  SELECT COALESCE(SUM(amount), 0) INTO _education
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false
    AND (
      category_code = '5'
      OR category_code ILIKE '%edu%'
      OR category_name ILIKE '%교육%'
    );

  -- 3번 = 보호구
  SELECT COALESCE(SUM(amount), 0) INTO _ppe
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false
    AND (
      category_code = '3'
      OR category_code ILIKE '%ppe%'
      OR category_name ILIKE '%보호구%'
    );

  SELECT COUNT(*) INTO _warning_count
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false
    AND classification_status = 'warning';

  SELECT COUNT(*) INTO _review_count
  FROM public.safety_cost_items
  WHERE report_id = _report_id AND COALESCE(is_deleted, false) = false
    AND classification_status IN ('review', 'pending');

  SELECT COUNT(*) INTO _missing_evidence
  FROM public.safety_cost_items sci
  WHERE sci.report_id = _report_id
    AND COALESCE(sci.is_deleted, false) = false
    AND sci.amount > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.safety_cost_evidence_files ef WHERE ef.item_id = sci.id
    );

  IF _total > 0 AND _personnel / _total > 0.5 THEN
    INSERT INTO public.safety_cost_violations
      (report_id, project_id, company_id, violation_code, severity, category_code, expected_amount, actual_amount, detail, legal_basis)
    VALUES (
      _report_id, _r.project_id, _r.company_id, 'PERSONNEL_RATIO_EXCEEDED', 'medium',
      '1', _total * 0.5, _personnel,
      '인건비성(1·8번)이 전체의 ' || round((_personnel / _total * 100)::numeric, 1) || '% (권고 50% 초과)',
      '건설업 산업안전보건관리비 계상 및 사용기준'
    );
    _violations := _violations + 1;
  END IF;

  IF _missing_evidence > 0 THEN
    INSERT INTO public.safety_cost_violations
      (report_id, project_id, company_id, violation_code, severity, detail, legal_basis)
    VALUES (
      _report_id, _r.project_id, _r.company_id, 'EVIDENCE_MISSING', 'high',
      '증빙파일 누락 항목 ' || _missing_evidence || '건',
      '건설업 산업안전보건관리비 사용내역 증빙 보관 의무'
    );
    _violations := _violations + 1;
  END IF;

  IF _warning_count > 0 THEN
    INSERT INTO public.safety_cost_violations
      (report_id, project_id, company_id, violation_code, severity, detail, legal_basis)
    VALUES (
      _report_id, _r.project_id, _r.company_id, 'UNUSABLE_ITEMS', 'high',
      '사용 불가 판정 항목 ' || _warning_count || '건',
      '건설업 산업안전보건관리비 계상 및 사용기준 제7조'
    );
    _violations := _violations + 1;
  END IF;

  IF _review_count > 0 THEN
    INSERT INTO public.safety_cost_violations
      (report_id, project_id, company_id, violation_code, severity, detail)
    VALUES (
      _report_id, _r.project_id, _r.company_id, 'CLASSIFICATION_PENDING', 'medium',
      '분류·검토 미확정 항목 ' || _review_count || '건'
    );
    _violations := _violations + 1;
  END IF;

  IF _violations > 0 THEN
    INSERT INTO public.notifications (user_id, type, title, message, project_id, related_type, related_id)
    SELECT
      pm.user_id,
      'safety_cost',
      '산업안전보건관리비 검증 위반 ' || _violations || '건',
      COALESCE(_r.title, '') || ' / ' || COALESCE(_r.report_month::text, ''),
      _r.project_id,
      'safety_cost_report',
      _report_id
    FROM public.project_members pm
    WHERE pm.project_id = _r.project_id
      AND pm.role_new IN ('project_admin', 'safety_manager');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'report_id', _report_id,
    'violations', _violations,
    'total', _total,
    'personnel', _personnel,
    'education', _education,
    'ppe', _ppe,
    'warning_count', _warning_count,
    'review_count', _review_count,
    'missing_evidence', _missing_evidence
  );
END;
$$;

COMMENT ON FUNCTION public.validate_safety_cost_report(uuid) IS
  'Validates monthly safety-cost report against category codes 1-9 and evidence completeness.';
