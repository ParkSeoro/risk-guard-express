-- ============================================================
-- 전자결재 플랫폼: 문서별 결재선 draft (설정 ≠ 상신)
-- ------------------------------------------------------------
-- - document_approval_drafts: 모듈(entity)별 결재선 저장소
-- - upsert / submit_from_draft RPC
-- - 기존 submit_approval 본문은 변경하지 않음 (허가서 경로 보존)
-- - 소비자 1호: assessment_run (위평). work_permit 미사용.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.document_approval_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'submitted', 'superseded')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ready_at timestamptz,
  submitted_at timestamptz,
  submitted_approval_version integer,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_document_approval_drafts_project
  ON public.document_approval_drafts (project_id);

CREATE INDEX IF NOT EXISTS idx_document_approval_drafts_entity
  ON public.document_approval_drafts (entity_type, entity_id);

COMMENT ON TABLE public.document_approval_drafts IS
  '전자결재 플랫폼 — 문서별 결재선 draft. 상신 전에 ready 여야 함. 프로젝트 approval_lines와 분리.';

ALTER TABLE public.document_approval_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view document approval drafts" ON public.document_approval_drafts;
CREATE POLICY "Members can view document approval drafts"
  ON public.document_approval_drafts
  FOR SELECT TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "Members can insert document approval drafts" ON public.document_approval_drafts;
CREATE POLICY "Members can insert document approval drafts"
  ON public.document_approval_drafts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

DROP POLICY IF EXISTS "Members can update document approval drafts" ON public.document_approval_drafts;
CREATE POLICY "Members can update document approval drafts"
  ON public.document_approval_drafts
  FOR UPDATE TO authenticated
  USING (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  )
  WITH CHECK (
    public.is_master(auth.uid())
    OR public.is_project_member(auth.uid(), project_id)
  );

GRANT SELECT, INSERT, UPDATE ON public.document_approval_drafts TO authenticated;

-- ---------- validation helper (platform) ----------
CREATE OR REPLACE FUNCTION public.validate_approval_draft_steps(
  _entity_type text,
  _steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  v_errors text[] := ARRAY[]::text[];
  v_step jsonb;
  v_i int := 0;
  v_has_client boolean := false;
  v_n int;
  v_seen text[] := ARRAY[]::text[];
  v_key text;
BEGIN
  v_n := jsonb_array_length(COALESCE(_steps, '[]'::jsonb));
  IF v_n < 2 THEN
    v_errors := array_append(v_errors, '결재 단계는 2개 이상이어야 합니다.');
  END IF;

  FOR v_step IN SELECT * FROM jsonb_array_elements(COALESCE(_steps, '[]'::jsonb))
  LOOP
    v_i := v_i + 1;
    IF COALESCE(v_step->>'position', '') = '' THEN
      v_errors := array_append(v_errors, format('%s단계: position 없음', v_i));
    END IF;
    IF NULLIF(v_step->>'user_id', '') IS NULL THEN
      v_errors := array_append(
        v_errors,
        format('%s단계(%s): 결재자 미지정', v_i, COALESCE(v_step->>'label', v_step->>'position', '?'))
      );
    END IF;
    IF COALESCE(v_step->>'position', '') <> '' AND NULLIF(v_step->>'user_id', '') IS NOT NULL THEN
      v_key := lower(v_step->>'position') || ':' || (v_step->>'user_id');
      IF v_key = ANY (v_seen) THEN
        v_errors := array_append(v_errors, format('%s단계: 동일 결재자·직책 중복', v_i));
      ELSE
        v_seen := array_append(v_seen, v_key);
      END IF;
    END IF;
    IF lower(COALESCE(v_step->>'position', '')) IN ('owner_cm', 'owner_sm', 'cm', 'sm') THEN
      v_has_client := true;
    END IF;
  END LOOP;

  -- 위평: 발주처 CM 또는 SM 필수 (SM만으로도 OK)
  IF _entity_type = 'assessment_run' AND NOT v_has_client THEN
    v_errors := array_append(v_errors, '발주처(CM/SM) 단계가 필요합니다. (SM만 있어도 됩니다)');
  END IF;

  RETURN jsonb_build_object(
    'ok', COALESCE(array_length(v_errors, 1), 0) = 0,
    'errors', to_jsonb(COALESCE(v_errors, ARRAY[]::text[]))
  );
END;
$fn$;

-- ---------- upsert draft (설정 저장 — 상신과 분리) ----------
CREATE OR REPLACE FUNCTION public.upsert_document_approval_draft(
  _entity_type text,
  _entity_id uuid,
  _project_id uuid,
  _company_id uuid,
  _steps jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_validation jsonb;
  v_ok boolean;
  v_errors jsonb;
  v_status text;
  v_parent_status text;
  v_row public.document_approval_drafts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT public.is_project_member(v_uid, _project_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _entity_type IS NULL OR _entity_id IS NULL OR _project_id IS NULL THEN
    RAISE EXCEPTION 'invalid_args';
  END IF;

  -- 결재 진행 중이면 draft 수정 잠금 (위평)
  IF _entity_type = 'assessment_run' THEN
    SELECT status INTO v_parent_status FROM public.assessment_runs WHERE id = _entity_id;
    IF v_parent_status = '결재진행' THEN
      -- 활성 반려가 있으면 재설정 허용
      IF NOT EXISTS (
        SELECT 1 FROM public.approvals a
         WHERE a.entity_type = 'assessment_run'
           AND a.entity_id = _entity_id
           AND a.status = '반려'
      ) THEN
        RAISE EXCEPTION 'draft_locked_while_in_approval';
      END IF;
    END IF;
  END IF;

  v_validation := public.validate_approval_draft_steps(_entity_type, _steps);
  v_ok := COALESCE((v_validation->>'ok')::boolean, false);
  v_errors := COALESCE(v_validation->'errors', '[]'::jsonb);
  v_status := CASE WHEN v_ok THEN 'ready' ELSE 'draft' END;

  INSERT INTO public.document_approval_drafts AS d (
    project_id, entity_type, entity_id, company_id, steps, status,
    validation_errors, ready_at, updated_by, updated_at
  ) VALUES (
    _project_id, _entity_type, _entity_id, _company_id, COALESCE(_steps, '[]'::jsonb), v_status,
    v_errors,
    CASE WHEN v_ok THEN now() ELSE NULL END,
    v_uid, now()
  )
  ON CONFLICT (entity_type, entity_id) DO UPDATE SET
    project_id = EXCLUDED.project_id,
    company_id = EXCLUDED.company_id,
    steps = EXCLUDED.steps,
    status = EXCLUDED.status,
    validation_errors = EXCLUDED.validation_errors,
    ready_at = EXCLUDED.ready_at,
    -- 재저장 시 이전 submitted 표시 해제
    submitted_at = NULL,
    submitted_approval_version = NULL,
    updated_by = EXCLUDED.updated_by,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'ready', v_row.status = 'ready',
    'errors', v_row.validation_errors,
    'steps', v_row.steps,
    'updated_at', v_row.updated_at
  );
END;
$fn$;

-- ---------- submit from draft only (상신 — 설정과 분리) ----------
CREATE OR REPLACE FUNCTION public.submit_approval_from_draft(
  _entity_type text,
  _entity_id uuid,
  _reason text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_draft public.document_approval_drafts%ROWTYPE;
  v_validation jsonb;
  v_expected int;
  v_inserted int;
  v_version int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_draft
    FROM public.document_approval_drafts
   WHERE entity_type = _entity_type AND entity_id = _entity_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'draft_not_found';
  END IF;
  IF NOT public.is_project_member(v_uid, v_draft.project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_draft.status IS DISTINCT FROM 'ready' THEN
    RAISE EXCEPTION 'draft_not_ready: %', COALESCE(v_draft.validation_errors::text, v_draft.status);
  END IF;

  -- 상신 직전 재검증 (레이스/우회 방어). silent skip 되는 불완전 step 거부.
  v_validation := public.validate_approval_draft_steps(_entity_type, v_draft.steps);
  IF NOT COALESCE((v_validation->>'ok')::boolean, false) THEN
    UPDATE public.document_approval_drafts
       SET status = 'draft',
           validation_errors = v_validation->'errors',
           ready_at = NULL,
           updated_at = now()
     WHERE id = v_draft.id;
    RAISE EXCEPTION 'draft_invalid: %', v_validation->'errors';
  END IF;

  v_expected := jsonb_array_length(v_draft.steps);

  -- 기존 엔진 재사용 — submit_approval 본문 미변경 (허가서 등 기존 호출자 안전)
  v_inserted := public.submit_approval(
    _entity_type,
    _entity_id,
    v_draft.project_id,
    v_draft.company_id,
    v_draft.steps,
    _reason
  );

  IF v_inserted IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'submit_step_mismatch: expected %, inserted %', v_expected, v_inserted;
  END IF;

  SELECT COALESCE(MAX(approval_version), 0) INTO v_version
    FROM public.approvals
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  UPDATE public.document_approval_drafts
     SET status = 'submitted',
         submitted_at = now(),
         submitted_approval_version = v_version,
         updated_by = v_uid,
         updated_at = now()
   WHERE id = v_draft.id;

  RETURN v_inserted;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.validate_approval_draft_steps(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_document_approval_draft(text, uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_approval_from_draft(text, uuid, text) TO authenticated;
