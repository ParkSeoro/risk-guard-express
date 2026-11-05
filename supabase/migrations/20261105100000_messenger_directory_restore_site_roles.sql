-- Master directory: the selected site keeps every messenger role and every company.
-- Other sites add project admins only. Other roles stay on their own site,
-- except a client company, which still sees its own people on other sites.
-- The badge is the site role, not the often-empty profile position.

DROP FUNCTION IF EXISTS public.get_chat_contacts(uuid, text);

CREATE FUNCTION public.get_chat_contacts(
  p_project_id uuid DEFAULT NULL,
  p_search_query text DEFAULT NULL
)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  company_name text,
  role text,
  phone text,
  avatar_url text,
  is_same_company boolean,
  project_id uuid,
  project_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_my_user_id UUID := auth.uid();
  v_my_company TEXT;
  v_is_master BOOLEAN;
BEGIN
  IF v_my_user_id IS NULL OR NOT public.can_use_messenger(v_my_user_id) THEN
    RETURN;
  END IF;

  SELECT company INTO v_my_company FROM public.profiles WHERE profiles.user_id = v_my_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_roles.user_id = v_my_user_id
      AND user_roles.role = 'master'::public.global_role
  ) INTO v_is_master;

  RETURN QUERY
  WITH visible AS (
    SELECT
      pr.user_id,
      pr.display_name,
      pr.company AS profile_company,
      pr.phone,
      pm.project_id,
      pm.role_new,
      proj.name AS project_name,
      COALESCE(NULLIF(btrim(c.name), ''), NULLIF(btrim(pr.company), ''), '소속 미지정') AS company_name,
      (p_project_id IS NOT NULL AND pm.project_id = p_project_id) AS on_selected,
      CASE pm.role_new
        WHEN 'project_admin'::public.project_role THEN 1
        WHEN 'safety_manager'::public.project_role THEN 2
        WHEN 'site_manager'::public.project_role THEN 3
        WHEN 'supervisor'::public.project_role THEN 4
        WHEN 'site_supervisor'::public.project_role THEN 5
        WHEN 'viewer'::public.project_role THEN 6
        ELSE 9
      END AS role_rank
    FROM public.profiles pr
    JOIN public.project_members pm ON pm.user_id = pr.user_id
    JOIN public.projects proj
      ON proj.id = pm.project_id
     AND COALESCE(proj.is_deleted, false) = false
    LEFT JOIN public.companies c
      ON c.id = pm.company_id
     AND COALESCE(c.is_deleted, false) = false
    WHERE pr.user_id <> v_my_user_id
      AND pr.account_status = 'active'
      AND public.can_use_messenger(pr.user_id)
      AND pm.role_new IS DISTINCT FROM 'worker'::public.project_role
      AND (
        p_search_query IS NULL
        OR pr.display_name ILIKE '%' || p_search_query || '%'
        OR pr.company ILIKE '%' || p_search_query || '%'
        OR c.name ILIKE '%' || p_search_query || '%'
        OR proj.name ILIKE '%' || p_search_query || '%'
      )
      AND (
        v_is_master
        OR pm.project_id IN (
          SELECT my_pm.project_id
          FROM public.project_members my_pm
          WHERE my_pm.user_id = v_my_user_id
        )
        OR public.messenger_shares_client_company(v_my_user_id, pr.user_id)
      )
      AND (
        CASE
          WHEN v_is_master THEN
            p_project_id IS NULL
            OR pm.project_id = p_project_id
            OR pm.role_new = 'project_admin'::public.project_role
          ELSE
            p_project_id IS NULL
            OR pm.project_id = p_project_id
            OR public.messenger_shares_client_company(v_my_user_id, pr.user_id)
        END
      )
  ),
  picked AS (
    SELECT DISTINCT ON (visible.user_id)
      visible.user_id,
      visible.display_name,
      visible.profile_company,
      visible.phone,
      visible.project_id,
      visible.role_new,
      visible.company_name,
      visible.on_selected
    FROM visible
    ORDER BY visible.user_id, visible.on_selected DESC, visible.role_rank, visible.project_name
  )
  SELECT
    picked.user_id,
    picked.display_name,
    picked.company_name,
    CASE picked.role_new
      WHEN 'project_admin'::public.project_role THEN '프로젝트 관리자'
      WHEN 'safety_manager'::public.project_role THEN '안전관리자'
      WHEN 'site_manager'::public.project_role THEN '현장소장'
      WHEN 'supervisor'::public.project_role THEN '감리'
      WHEN 'site_supervisor'::public.project_role THEN '관리감독자'
      WHEN 'viewer'::public.project_role THEN '열람자'
      ELSE picked.role_new::text
    END,
    CASE
      WHEN picked.profile_company IS NOT NULL AND picked.profile_company = v_my_company THEN picked.phone
      ELSE NULL
    END,
    NULL::text,
    (picked.profile_company IS NOT NULL AND picked.profile_company = v_my_company)
      OR (picked.company_name = v_my_company),
    CASE WHEN picked.on_selected THEN picked.project_id ELSE NULL END,
    CASE
      WHEN picked.on_selected THEN NULL
      ELSE (
        SELECT string_agg(DISTINCT visible.project_name, ', ' ORDER BY visible.project_name)
        FROM visible
        WHERE visible.user_id = picked.user_id
          AND NOT visible.on_selected
      )
    END
  FROM picked;
END;
$$;

REVOKE ALL ON FUNCTION public.get_chat_contacts(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts(uuid, text) TO authenticated, service_role;
