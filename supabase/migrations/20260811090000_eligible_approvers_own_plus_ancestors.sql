-- SSOT: 결재 후보 = 소속 회사 + 상위 체인 + 프로젝트 발주처/시공사
-- (peer 협력사·공급사는 제외). 전 모듈(위평/허가서/계획서/템플릿)이 이 RPC만 사용.
-- Client-side filterApproversForStep 가 단계·직책으로 추가 축소.

CREATE OR REPLACE FUNCTION public.get_eligible_approvers(
  _project_id uuid,
  _submitter_company_id uuid
)
RETURNS TABLE(
  out_user_id uuid,
  out_display_name text,
  out_company_id uuid,
  out_company_name text,
  out_company_type text,
  out_position text,
  out_role text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_project_member(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  ancestors AS (
    -- 소속 + parent_company_id 상위 체인 (project_companies 우선)
    SELECT c.id,
           COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_company_id,
           c.name, c.type, 0 AS depth
    FROM public.companies c
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND pc.is_deleted = false
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND COALESCE(c.is_deleted, false) = false
    UNION ALL
    SELECT c.id,
           COALESCE(pc.parent_company_id, c.parent_company_id),
           c.name, c.type, a.depth + 1
    FROM ancestors a
    JOIN public.companies c ON c.id = a.parent_company_id
    LEFT JOIN public.project_companies pc
      ON pc.company_id = c.id AND pc.project_id = _project_id AND pc.is_deleted = false
    WHERE COALESCE(c.is_deleted, false) = false
      AND a.depth < 8
  ),
  project_upper AS (
    -- 상위 끝단: 프로젝트에 등록된 발주처·시공사 (트리 누락 시에도 발주처 보이게)
    SELECT DISTINCT c.id, c.name, c.type
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE pc.project_id = _project_id
      AND COALESCE(pc.is_deleted, false) = false
      AND COALESCE(c.is_deleted, false) = false
      AND lower(trim(COALESCE(c.type, ''))) IN (
        'client', '발주처', 'owner',
        'gc', '시공사', '원도급', '원청', 'general_contractor'
      )
  ),
  eligible_cos AS (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM project_upper
    UNION
    -- submitter null (마스터 등): 프로젝트 전 회사 중 상위 유형만
    SELECT c.id
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE _submitter_company_id IS NULL
      AND pc.project_id = _project_id
      AND COALESCE(pc.is_deleted, false) = false
      AND COALESCE(c.is_deleted, false) = false
  )
  SELECT
    pm.user_id AS out_user_id,
    COALESCE(pr.display_name, '') AS out_display_name,
    pm.company_id AS out_company_id,
    COALESCE(co.name, '') AS out_company_name,
    COALESCE(co.type, '') AS out_company_type,
    COALESCE(pm.position_new::text, '') AS out_position,
    COALESCE(pm.role_new::text, '') AS out_role
  FROM public.project_members pm
  LEFT JOIN public.profiles pr ON pr.user_id = pm.user_id
  LEFT JOIN public.companies co ON co.id = pm.company_id
  WHERE pm.project_id = _project_id
    AND pm.company_id IN (SELECT id FROM eligible_cos)
    AND (
      pm.role_new::text IN (
        'project_admin', 'safety_manager', 'site_manager',
        'supervisor', 'site_supervisor', 'contractor'
      )
      OR pm.position_new IS NOT NULL
    );
END;
$$;

COMMENT ON FUNCTION public.get_eligible_approvers(uuid, uuid) IS
  '결재 후보 SSOT: 소속+상위체인+프로젝트 발주처/시공사. 전 모듈 공통.';

GRANT EXECUTE ON FUNCTION public.get_eligible_approvers(uuid, uuid) TO authenticated, service_role;
