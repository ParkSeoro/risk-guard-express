-- =============================================================================
-- Dual persona (same legal company, multiple project roles) — SAFE Phase 1
-- =============================================================================
-- Goals:
-- 1) Allow the same company_id twice in one project (e.g. GC + 협력사 under another GC)
-- 2) NEVER break existing approval / RLS / membership behavior for single-role companies
-- 3) Secondary personas are ORG-CHART ONLY until docs/approvals are persona-scoped (Phase 2)
--
-- access_edge = true  → included in RLS descendant walks & primary parent resolution
-- access_edge = false → hierarchy display only (no permission grant via that parent edge)
-- =============================================================================

-- 1) Flag: which persona row participates in access / primary parent walks
ALTER TABLE public.project_companies
  ADD COLUMN IF NOT EXISTS access_edge boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.project_companies.access_edge IS
  'When true, this persona edge is used for RLS tree access and primary parent resolution. Secondary dual-role personas must stay false until Phase 2 (persona-scoped docs).';

-- Existing rows: exactly one access edge per (project, company) among active rows.
-- Prefer persona whose role matches master companies.type, then GC, then oldest.
WITH ranked AS (
  SELECT pc.id,
         ROW_NUMBER() OVER (
           PARTITION BY pc.project_id, pc.company_id
           ORDER BY
             CASE
               WHEN lower(trim(COALESCE(pc.role_in_project, '')))
                    = lower(trim(COALESCE(c.type, ''))) THEN 0
               ELSE 1
             END,
             CASE
               WHEN lower(trim(COALESCE(pc.role_in_project, '')))
                    IN ('gc', '시공사', '원도급', '원청', 'general_contractor') THEN 0
               ELSE 1
             END,
             pc.created_at ASC NULLS LAST,
             pc.id ASC
         ) AS rn
    FROM public.project_companies pc
    LEFT JOIN public.companies c ON c.id = pc.company_id
   WHERE COALESCE(pc.is_deleted, false) = false
)
UPDATE public.project_companies pc
   SET access_edge = (ranked.rn = 1)
  FROM ranked
 WHERE pc.id = ranked.id;

-- Soft-deleted rows: keep default true (irrelevant); no-op

-- 2) Replace UNIQUE(project_id, company_id) with persona uniqueness
ALTER TABLE public.project_companies
  DROP CONSTRAINT IF EXISTS project_companies_project_id_company_id_key;

DROP INDEX IF EXISTS public.project_companies_pc_uidx;

-- Same legal company may appear multiple times with different role/parent.
-- Identical persona (same role + same parent) remains unique among active rows.
CREATE UNIQUE INDEX IF NOT EXISTS project_companies_persona_uidx
  ON public.project_companies (
    project_id,
    company_id,
    role_in_project,
    (COALESCE(parent_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  WHERE COALESCE(is_deleted, false) = false;

-- At most one access_edge persona per (project, company) among active rows
CREATE UNIQUE INDEX IF NOT EXISTS project_companies_one_access_edge_uidx
  ON public.project_companies (project_id, company_id)
  WHERE COALESCE(is_deleted, false) = false
    AND access_edge = true;

-- 3) Scaffolding for Phase 2 (nullable — unused by runtime until wired)
ALTER TABLE public.project_members
  ADD COLUMN IF NOT EXISTS project_company_id uuid
    REFERENCES public.project_companies(id) ON DELETE SET NULL;

ALTER TABLE public.approval_route_templates
  ADD COLUMN IF NOT EXISTS project_company_id uuid
    REFERENCES public.project_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_members_project_company_id_idx
  ON public.project_members (project_company_id)
  WHERE project_company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS approval_route_templates_project_company_id_idx
  ON public.approval_route_templates (project_company_id)
  WHERE project_company_id IS NOT NULL;

-- 4) Primary persona resolver (deterministic; preserves single-role behavior)
CREATE OR REPLACE FUNCTION public.primary_project_company_parent(
  _project_id uuid,
  _company_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pc.parent_company_id
    FROM public.project_companies pc
   WHERE pc.project_id = _project_id
     AND pc.company_id = _company_id
     AND COALESCE(pc.is_deleted, false) = false
   ORDER BY pc.access_edge DESC, pc.created_at ASC NULLS LAST, pc.id ASC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.primary_project_company_parent(uuid, uuid) TO authenticated, service_role;

-- 5) Harden get_eligible_approvers: parent walk uses PRIMARY persona only
--    (avoids duplicate/ambiguous ancestor chains if dual personas exist)
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
    SELECT c.id,
           COALESCE(
             public.primary_project_company_parent(_project_id, c.id),
             c.parent_company_id
           ) AS parent_company_id,
           c.name, c.type, 0 AS depth
    FROM public.companies c
    WHERE _submitter_company_id IS NOT NULL
      AND c.id = _submitter_company_id
      AND c.is_deleted = false
    UNION ALL
    SELECT c.id,
           COALESCE(
             public.primary_project_company_parent(_project_id, c.id),
             c.parent_company_id
           ),
           c.name, c.type, a.depth + 1
    FROM ancestors a
    JOIN public.companies c ON c.id = a.parent_company_id
    WHERE c.is_deleted = false AND a.depth < 5
  ),
  project_cos AS (
    SELECT DISTINCT c.id, c.name, c.type
    FROM public.project_companies pc
    JOIN public.companies c ON c.id = pc.company_id
    WHERE pc.project_id = _project_id
      AND pc.is_deleted = false
      AND c.is_deleted = false
      AND lower(COALESCE(c.type, '')) IN ('client', 'gc', 'contractor', 'vendor', '발주처', '시공사', '협력사')
  ),
  eligible_cos AS (
    SELECT id FROM ancestors
    UNION
    SELECT id FROM project_cos
     WHERE lower(COALESCE(type, '')) IN ('client', 'gc', '발주처', '시공사')
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
        'supervisor', 'site_supervisor', 'contractor', 'worker'
      )
      OR pm.position_new IS NOT NULL
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_eligible_approvers(uuid, uuid) TO authenticated, service_role;

-- 6) Harden can_access_company_data / can_write: only follow access_edge parent links
--    Secondary dual-role edges must NOT grant peer-GC read of the legal company's docs.
CREATE OR REPLACE FUNCTION public.can_access_company_data(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
  _own_company uuid;
  _own_type text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  IF _project_id IS NULL THEN
    IF _company_id IS NULL THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.project_companies pc
      WHERE pc.company_id = _company_id
        AND COALESCE(pc.is_deleted, false) = false
        AND public.is_project_member(_user_id, pc.project_id)
    );
  END IF;

  SELECT pm.role_new, pm.company_id, lower(trim(COALESCE(c.type, '')))
    INTO _role, _own_company, _own_type
  FROM public.project_members pm
  LEFT JOIN public.companies c ON c.id = pm.company_id
  WHERE pm.user_id = _user_id AND pm.project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;

  -- Project-scoped rows (no company): any project member may read
  IF _company_id IS NULL THEN
    RETURN true;
  END IF;

  -- 협력사 / 공급사: 자사만
  IF _own_type IN (
    'contractor', 'vendor',
    '협력사', '하청', 'subcontractor',
    '공급사', '납품사'
  ) THEN
    IF _own_company IS NULL THEN
      RETURN false;
    END IF;
    RETURN _company_id = _own_company;
  END IF;

  -- 시공사(gc): 자사 + 하위만 (PA/SM 포함 — 타 시공사 불가)
  IF _own_type IN ('gc', '시공사', '원도급', '원청', 'general_contractor') THEN
    IF _own_company IS NULL THEN
      RETURN false;
    END IF;
    IF _company_id = _own_company THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      WITH RECURSIVE tree AS (
        SELECT _own_company AS id
        UNION ALL
        SELECT child.id
        FROM (
          -- Project-scoped access edges only (never secondary dual-role org-chart edges).
          -- Prefer pc.parent_company_id; fall back to companies.parent only when pc.parent is null
          -- so legacy single-role trees still work without letting a stale global parent
          -- re-attach a peer-GC path under a secondary dual-role placement.
          SELECT pc.company_id AS id,
                 COALESCE(pc.parent_company_id, c.parent_company_id) AS parent_id
            FROM public.project_companies pc
            LEFT JOIN public.companies c ON c.id = pc.company_id
           WHERE pc.project_id = _project_id
             AND COALESCE(pc.is_deleted, false) = false
             AND COALESCE(pc.access_edge, true) = true
        ) child
        JOIN tree t ON child.parent_id = t.id
        WHERE child.id IS NOT NULL
          AND child.id <> t.id
      )
      SELECT 1 FROM tree WHERE id = _company_id
    );
  END IF;

  -- 발주처(client) PA/SM: 프로젝트 전체
  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;

  -- 발주처 site_manager/supervisor: 프로젝트 전체 (발주 감독)
  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN ('site_manager', 'supervisor', 'site_supervisor') THEN
    RETURN true;
  END IF;

  IF _own_company IS NULL THEN
    RETURN false;
  END IF;

  IF _company_id = _own_company THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.can_write_company_data(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
  _own_company uuid;
  _own_type text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  IF _project_id IS NULL THEN
    IF _company_id IS NULL THEN
      RETURN false;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.project_companies pc
      WHERE pc.company_id = _company_id
        AND COALESCE(pc.is_deleted, false) = false
        AND public.has_project_role(
          _user_id,
          pc.project_id,
          ARRAY[
            'project_admin', 'safety_manager',
            'site_manager', 'supervisor', 'site_supervisor'
          ]::public.project_role[]
        )
        AND public.can_access_company_data(_user_id, pc.project_id, _company_id)
    );
  END IF;

  SELECT pm.role_new, pm.company_id, lower(trim(COALESCE(c.type, '')))
    INTO _role, _own_company, _own_type
  FROM public.project_members pm
  LEFT JOIN public.companies c ON c.id = pm.company_id
  WHERE pm.user_id = _user_id AND pm.project_id = _project_id
  LIMIT 1;

  IF _role IS NULL THEN
    RETURN false;
  END IF;
  IF _role IN ('viewer', 'worker') THEN
    RETURN false;
  END IF;

  IF _company_id IS NULL THEN
    RETURN _role IN (
      'project_admin', 'safety_manager',
      'site_manager', 'supervisor', 'site_supervisor'
    );
  END IF;

  IF NOT public.can_access_company_data(_user_id, _project_id, _company_id) THEN
    RETURN false;
  END IF;

  IF _own_type IN ('client', '발주처', 'owner')
     AND _role IN (
       'project_admin', 'safety_manager',
       'site_manager', 'supervisor', 'site_supervisor'
     ) THEN
    RETURN true;
  END IF;

  IF _role IN (
    'project_admin', 'safety_manager',
    'site_manager', 'supervisor', 'site_supervisor'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.can_access_company_data(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_company_data(uuid, uuid, uuid) TO authenticated, service_role;

-- 7) Signup directory: one row per legal company (access_edge only).
--    Dual-role org-chart personas must not appear twice in manager/worker signup pickers.
CREATE OR REPLACE FUNCTION public.get_signup_company_directory()
RETURNS TABLE (
  project_id uuid,
  project_name text,
  company_id uuid,
  company_name text,
  company_type text
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
    COALESCE(NULLIF(btrim(c.type), ''), pc.role_in_project::text) AS company_type
  FROM public.project_companies pc
  JOIN public.projects p ON p.id = pc.project_id
  JOIN public.companies c ON c.id = pc.company_id
  WHERE pc.is_deleted = false
    AND COALESCE(pc.access_edge, true) = true
    AND c.is_deleted = false
    AND COALESCE(p.is_deleted, false) = false
    AND COALESCE(NULLIF(btrim(p.status), ''), '진행중') NOT IN ('완료', '폐기', '삭제')
  ORDER BY p.name, c.name;
$$;

REVOKE ALL ON FUNCTION public.get_signup_company_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_signup_company_directory() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_signup_company_directory() IS
  'Signup company picker — one access_edge persona per legal company (dual-role safe).';

-- Keep view aligned (legacy readers / FK type refs)
CREATE OR REPLACE VIEW public.signup_company_directory AS
SELECT p.id AS project_id, p.name AS project_name,
       c.id AS company_id, c.name AS company_name,
       COALESCE(NULLIF(btrim(c.type), ''), pc.role_in_project) AS company_type
FROM public.project_companies pc
JOIN public.projects p ON p.id = pc.project_id
JOIN public.companies c ON c.id = pc.company_id
WHERE pc.is_deleted = false
  AND COALESCE(pc.access_edge, true) = true
  AND c.is_deleted = false;

GRANT SELECT ON public.signup_company_directory TO anon, authenticated;
