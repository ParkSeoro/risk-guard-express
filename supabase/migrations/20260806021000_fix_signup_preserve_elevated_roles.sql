-- =============================================================================
-- FIX: worker signup / bulk provision must NOT downgrade existing manager roles
-- =============================================================================
-- Symptom: User Management shows 작업자 for people who were 안전관리자 등.
-- Cause: process_signup_company_selection ON CONFLICT always wrote EXCLUDED.role_new
--   (regression vs 20260727110000 which preserved role_new).
-- Trigger: provision-worker-accounts / complete_worker_roster_signup call this RPC
--   with position WORKER for @worker.local accounts → overwrites manager memberships.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_signup_company_selection(
  _user_id uuid, _project_id uuid, _company_id uuid, _position text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _pos public.project_position;
  _role public.project_role;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.project_companies
    WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false
  ) THEN
    RAISE EXCEPTION '유효하지 않은 프로젝트/업체 조합입니다';
  END IF;

  _pos := public.map_signup_position(_position);
  _role := public.map_signup_position_to_role(_pos);

  IF public.is_master(_user_id)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE account_status = 'active') THEN
    UPDATE public.profiles SET account_status = 'active' WHERE user_id = _user_id;
    IF public.is_master(_user_id) THEN
      _role := 'project_admin'::public.project_role;
    END IF;
  ELSE
    UPDATE public.profiles SET account_status = 'pending' WHERE user_id = _user_id;
  END IF;

  INSERT INTO public.project_members (project_id, user_id, company_id, position_new, role_new)
  VALUES (_project_id, _user_id, _company_id, _pos, _role)
  ON CONFLICT (project_id, user_id) DO UPDATE
    SET company_id = COALESCE(EXCLUDED.company_id, public.project_members.company_id),
        -- Never downgrade elevated project roles via worker signup / bulk provision
        role_new = CASE
          WHEN public.is_master(_user_id) THEN 'project_admin'::public.project_role
          WHEN public.project_members.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role,
            'supervisor'::public.project_role,
            'site_supervisor'::public.project_role
          ) THEN public.project_members.role_new
          ELSE EXCLUDED.role_new
        END,
        position_new = CASE
          WHEN public.is_master(_user_id) THEN EXCLUDED.position_new
          WHEN public.project_members.role_new IN (
            'project_admin'::public.project_role,
            'safety_manager'::public.project_role,
            'site_manager'::public.project_role,
            'supervisor'::public.project_role,
            'site_supervisor'::public.project_role
          ) THEN public.project_members.position_new
          ELSE EXCLUDED.position_new
        END;
END $$;

COMMENT ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text) IS
  'Signup/provision membership upsert. Preserves elevated project roles (PA/SM/현장/감리/관리감독자) on conflict.';

GRANT EXECUTE ON FUNCTION public.process_signup_company_selection(uuid, uuid, uuid, text)
  TO anon, authenticated, service_role;
