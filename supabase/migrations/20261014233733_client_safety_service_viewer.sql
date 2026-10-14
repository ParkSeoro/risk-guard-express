-- 발주처 안전용역 회사의 열람자는 그 프로젝트 문서를 읽기만 한다.
-- can_access_company_data 는 저장 정책이 그대로 쓰므로 바꾸지 않는다.

ALTER TABLE public.project_companies
  ADD COLUMN IF NOT EXISTS client_safety_service boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.project_companies.client_safety_service IS
  '발주처 안전용역. 이 회사의 열람자만 프로젝트 전체를 읽는다.';

CREATE OR REPLACE FUNCTION public.is_client_safety_viewer(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.project_members pm
      JOIN public.project_companies pc
        ON pc.project_id = pm.project_id
       AND pc.company_id = pm.company_id
     WHERE pm.user_id = _user_id
       AND pm.project_id = _project_id
       AND pm.role_new = 'viewer'::public.project_role
       AND COALESCE(pc.is_deleted, false) = false
       AND pc.client_safety_service = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_company_data(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.can_access_company_data(_user_id, _project_id, _company_id)
    OR (
      public.is_client_safety_viewer(_user_id, _project_id)
      AND (
        _company_id IS NULL
        OR EXISTS (
          SELECT 1
            FROM public.project_companies pc
           WHERE pc.project_id = _project_id
             AND pc.company_id = _company_id
             AND COALESCE(pc.is_deleted, false) = false
        )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.is_client_safety_viewer(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_company_data(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_client_safety_viewer(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_company_data(uuid, uuid, uuid) TO authenticated, service_role;

-- 조회 정책만 읽기 함수로 바꾼다. INSERT/UPDATE/DELETE 는 기존 함수를 유지한다.
DO $$
DECLARE
  r record;
  new_using text;
BEGIN
  FOR r IN
    SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND p.polcmd = 'r'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%can_access_company_data(%'
       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%can_read_company_data(%'
  LOOP
    new_using := replace(r.using_expr, 'can_access_company_data(', 'can_read_company_data(');
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.polname, r.relname, new_using);
  END LOOP;

  FOR r IN
    SELECT c.relname, p.polname, pg_get_expr(p.polqual, p.polrelid) AS using_expr
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND p.polcmd = 'r'
       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%can_access_safety_cost(%'
       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%is_client_safety_viewer(%'
  LOOP
    new_using := '(' || r.using_expr || ') OR public.is_client_safety_viewer(auth.uid(), project_id)';
    EXECUTE format('ALTER POLICY %I ON public.%I USING (%s)', r.polname, r.relname, new_using);
  END LOOP;
END $$;

ALTER POLICY "Members can view runs" ON public.assessment_runs
  USING (
    public.can_read_assessment_run(assessment_runs.*, auth.uid())
    OR public.is_client_safety_viewer(auth.uid(), project_id)
  );

-- 글로벌21: 발주사 안전팀 용역. 현재 현장소장 계정은 열람자로 내린다.
UPDATE public.project_companies pc
   SET client_safety_service = true
  FROM public.companies c
 WHERE c.id = pc.company_id
   AND btrim(c.name) = '글로벌21'
   AND COALESCE(pc.is_deleted, false) = false;

UPDATE public.project_members pm
   SET role_new = 'viewer'::public.project_role
  FROM public.companies c
  JOIN public.project_companies pc
    ON pc.company_id = c.id
   AND pc.client_safety_service = true
   AND COALESCE(pc.is_deleted, false) = false
 WHERE pm.company_id = c.id
   AND pm.project_id = pc.project_id
   AND btrim(c.name) = '글로벌21'
   AND pm.role_new = 'project_admin'::public.project_role;
