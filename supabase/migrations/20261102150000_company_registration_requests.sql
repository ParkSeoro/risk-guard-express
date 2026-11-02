-- Company registration requests: anon cannot read or write the table.
-- Submit and approve go through SECURITY DEFINER functions.

CREATE TABLE IF NOT EXISTS public.company_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_kind text NOT NULL CHECK (request_kind IN ('create', 'link')),
  name text NOT NULL,
  business_no text,
  type text NOT NULL DEFAULT 'contractor',
  contact text,
  address text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  parent_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  requester_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_name text NOT NULL,
  requester_email text,
  requester_phone text,
  memo text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  matched_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS company_registration_requests_pending_idx
  ON public.company_registration_requests (status, created_at DESC);

ALTER TABLE public.company_registration_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_registration_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.company_registration_requests TO authenticated;

DROP POLICY IF EXISTS company_registration_requests_select ON public.company_registration_requests;
CREATE POLICY company_registration_requests_select
  ON public.company_registration_requests
  FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR public.is_master(auth.uid()));

-- Construction info writes must use this site's project_id, not the legacy companies.project_id.
DROP POLICY IF EXISTS "Writers can insert construction info" ON public.company_construction_info;
DROP POLICY IF EXISTS "Writers can update construction info" ON public.company_construction_info;
CREATE POLICY "Writers can insert construction info"
  ON public.company_construction_info
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));
CREATE POLICY "Writers can update construction info"
  ON public.company_construction_info
  FOR UPDATE
  TO authenticated
  USING (public.can_write_company_data(auth.uid(), project_id, company_id))
  WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

CREATE OR REPLACE FUNCTION public.submit_company_registration_request(
  p_name text,
  p_business_no text,
  p_type text,
  p_contact text,
  p_address text,
  p_project_id uuid,
  p_parent_company_id uuid,
  p_requester_name text,
  p_requester_email text,
  p_requester_phone text,
  p_memo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text := btrim(coalesce(p_name, ''));
  v_key text;
  v_biz text;
  v_type text := lower(btrim(coalesce(p_type, 'contractor')));
  v_company uuid;
  v_pending uuid;
  v_kind text;
BEGIN
  IF v_name = '' OR btrim(coalesce(p_requester_name, '')) = '' THEN
    RETURN jsonb_build_object('result', 'invalid', 'message', '회사명과 신청자 이름이 필요합니다.');
  END IF;
  IF p_project_id IS NULL THEN
    RETURN jsonb_build_object('result', 'invalid', 'message', '참여 현장을 선택하세요.');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND coalesce(p.is_deleted, false) = false
      AND coalesce(nullif(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ) THEN
    RETURN jsonb_build_object('result', 'invalid', 'message', '선택할 수 없는 현장입니다.');
  END IF;
  IF v_type NOT IN ('client', 'gc', 'contractor', 'vendor') THEN
    v_type := 'contractor';
  END IF;
  IF v_type = 'contractor' THEN
    IF p_parent_company_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.project_companies pc
      WHERE pc.project_id = p_project_id
        AND pc.company_id = p_parent_company_id
        AND coalesce(pc.is_deleted, false) = false
        AND pc.role_in_project = 'gc'
    ) THEN
      RETURN jsonb_build_object('result', 'invalid', 'message', '협력사는 이 현장에 연결된 시공사를 상위 업체로 고르세요.');
    END IF;
  END IF;

  v_key := lower(regexp_replace(v_name, '\s+', '', 'g'));
  v_biz := regexp_replace(coalesce(p_business_no, ''), '[^0-9]', '', 'g');

  SELECT c.id INTO v_company
  FROM public.companies c
  WHERE coalesce(c.is_deleted, false) = false
    AND (
      lower(regexp_replace(coalesce(c.name, ''), '\s+', '', 'g')) = v_key
      OR (v_biz <> '' AND regexp_replace(coalesce(c.business_no, ''), '[^0-9]', '', 'g') = v_biz)
    )
  ORDER BY (lower(regexp_replace(coalesce(c.name, ''), '\s+', '', 'g')) = v_key) DESC
  LIMIT 1;

  IF v_company IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.project_companies pc
    WHERE pc.project_id = p_project_id
      AND pc.company_id = v_company
      AND coalesce(pc.is_deleted, false) = false
  ) THEN
    RETURN jsonb_build_object('result', 'already_linked', 'company_id', v_company);
  END IF;

  v_kind := CASE WHEN v_company IS NULL THEN 'create' ELSE 'link' END;

  SELECT r.id INTO v_pending
  FROM public.company_registration_requests r
  WHERE r.status = 'pending'
    AND r.project_id = p_project_id
    AND (
      lower(regexp_replace(coalesce(r.name, ''), '\s+', '', 'g')) = v_key
      OR (v_biz <> '' AND regexp_replace(coalesce(r.business_no, ''), '[^0-9]', '', 'g') = v_biz)
    )
  LIMIT 1;

  IF v_pending IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'already_pending');
  END IF;

  INSERT INTO public.company_registration_requests (
    request_kind, name, business_no, type, contact, address,
    project_id, parent_company_id, requester_id, requester_name,
    requester_email, requester_phone, memo, matched_company_id
  ) VALUES (
    v_kind, v_name, nullif(btrim(coalesce(p_business_no, '')), ''), v_type,
    nullif(btrim(coalesce(p_contact, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    p_project_id,
    CASE WHEN v_type = 'contractor' THEN p_parent_company_id ELSE NULL END,
    auth.uid(),
    btrim(p_requester_name),
    nullif(btrim(coalesce(p_requester_email, '')), ''),
    nullif(btrim(coalesce(p_requester_phone, '')), ''),
    nullif(btrim(coalesce(p_memo, '')), ''),
    v_company
  )
  RETURNING id INTO v_pending;

  RETURN jsonb_build_object('result', 'submitted', 'request_id', v_pending, 'request_kind', v_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_company_registration_request(
  p_request_id uuid,
  p_use_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r public.company_registration_requests%ROWTYPE;
  v_company uuid;
  v_key text;
  v_biz text;
  v_existing_link uuid;
  v_link_deleted boolean;
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master only';
  END IF;

  SELECT * INTO r
  FROM public.company_registration_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'missing');
  END IF;
  IF r.status <> 'pending' THEN
    RETURN jsonb_build_object('result', 'not_pending');
  END IF;
  IF r.type = 'contractor' AND r.project_id IS NOT NULL THEN
    IF r.parent_company_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.project_companies pc
      WHERE pc.project_id = r.project_id
        AND pc.company_id = r.parent_company_id
        AND coalesce(pc.is_deleted, false) = false
        AND pc.role_in_project = 'gc'
    ) THEN
      RETURN jsonb_build_object('result', 'invalid_parent', 'message', '상위 시공사가 이 현장에 없습니다.');
    END IF;
  END IF;

  v_key := lower(regexp_replace(coalesce(r.name, ''), '\s+', '', 'g'));
  v_biz := regexp_replace(coalesce(r.business_no, ''), '[^0-9]', '', 'g');

  IF p_use_company_id IS NOT NULL THEN
    SELECT c.id INTO v_company
    FROM public.companies c
    WHERE c.id = p_use_company_id AND coalesce(c.is_deleted, false) = false;
    IF v_company IS NULL THEN
      RETURN jsonb_build_object('result', 'missing_company');
    END IF;
  ELSE
    SELECT c.id INTO v_company
    FROM public.companies c
    WHERE coalesce(c.is_deleted, false) = false
      AND (
        lower(regexp_replace(coalesce(c.name, ''), '\s+', '', 'g')) = v_key
        OR (v_biz <> '' AND regexp_replace(coalesce(c.business_no, ''), '[^0-9]', '', 'g') = v_biz)
      )
    ORDER BY (lower(regexp_replace(coalesce(c.name, ''), '\s+', '', 'g')) = v_key) DESC
    LIMIT 1;
  END IF;

  IF v_company IS NULL THEN
    INSERT INTO public.companies (name, type, business_no, contact, address)
    VALUES (r.name, r.type, r.business_no, r.contact, r.address)
    RETURNING id INTO v_company;
  END IF;

  IF r.project_id IS NOT NULL THEN
    SELECT pc.id, coalesce(pc.is_deleted, false)
      INTO v_existing_link, v_link_deleted
    FROM public.project_companies pc
    WHERE pc.project_id = r.project_id AND pc.company_id = v_company
    LIMIT 1;

    IF v_existing_link IS NULL THEN
      INSERT INTO public.project_companies (
        project_id, company_id, role_in_project, parent_company_id, is_deleted
      ) VALUES (
        r.project_id, v_company, r.type,
        CASE WHEN r.type = 'contractor' THEN r.parent_company_id ELSE NULL END,
        false
      );
    ELSIF v_link_deleted THEN
      UPDATE public.project_companies
      SET is_deleted = false,
          role_in_project = r.type,
          parent_company_id = CASE WHEN r.type = 'contractor' THEN r.parent_company_id ELSE parent_company_id END
      WHERE id = v_existing_link;
    END IF;
    -- An active link keeps its role_in_project.
  END IF;

  UPDATE public.company_registration_requests
  SET status = 'approved',
      created_company_id = v_company,
      matched_company_id = v_company,
      updated_at = now()
  WHERE id = r.id;

  RETURN jsonb_build_object('result', 'approved', 'company_id', v_company);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_company_registration_request(
  p_request_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION 'master only';
  END IF;
  IF btrim(coalesce(p_reason, '')) = '' THEN
    RETURN jsonb_build_object('result', 'invalid', 'message', '거절 사유를 입력하세요.');
  END IF;
  UPDATE public.company_registration_requests
  SET status = 'rejected',
      rejection_reason = btrim(p_reason),
      updated_at = now()
  WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_pending');
  END IF;
  RETURN jsonb_build_object('result', 'rejected');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_company_registration_request(text, text, text, text, text, uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_company_registration_request(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_company_registration_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_company_registration_request(text, text, text, text, text, uuid, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_company_registration_request(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_company_registration_request(uuid, text) TO authenticated;

-- Signup directory must expose the project role so parent-GC pickers do not use companies.type.
DROP FUNCTION IF EXISTS public.get_signup_company_directory();

CREATE FUNCTION public.get_signup_company_directory()
RETURNS TABLE (
  project_id uuid,
  project_name text,
  company_id uuid,
  company_name text,
  company_type text,
  role_in_project text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id,
    p.name,
    c.id,
    c.name,
    COALESCE(NULLIF(btrim(c.type), ''), pc.role_in_project::text) AS company_type,
    pc.role_in_project::text
  FROM public.project_companies pc
  JOIN public.projects p ON p.id = pc.project_id
  JOIN public.companies c ON c.id = pc.company_id
  WHERE pc.is_deleted = false
    AND c.is_deleted = false
    AND COALESCE(p.is_deleted, false) = false
    AND COALESCE(NULLIF(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ORDER BY p.name, c.name;
$$;

REVOKE ALL ON FUNCTION public.get_signup_company_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_company_directory() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_signup_company_directory() IS
  'Public signup company picker. company_type prefers the master type; role_in_project is the site role.';
