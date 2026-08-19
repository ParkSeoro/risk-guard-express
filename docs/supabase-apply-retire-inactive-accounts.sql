-- SafeNex: 계정 로그인 차단 (삭제 아님). Paste into SQL Editor and Run once.
-- Uses body dollar-quotes.

-- Retire account = block login, keep profile/stamps.
-- Do NOT delete auth.users (profiles.user_id ON DELETE CASCADE would wipe identity).

CREATE OR REPLACE FUNCTION public.account_is_active(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT COALESCE(
    (SELECT p.account_status FROM public.profiles p WHERE p.user_id = _user_id),
    'active'
  ) = 'active';
$body$;

REVOKE ALL ON FUNCTION public.account_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_is_active(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_auth_login_blocked(_user_id uuid, _blocked boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  IF _blocked THEN
    BEGIN
      UPDATE auth.users SET banned_until = 'infinity'::timestamptz WHERE id = _user_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL;
    END;
    BEGIN
      DELETE FROM auth.refresh_tokens WHERE user_id = _user_id::text;
    EXCEPTION WHEN undefined_table OR undefined_function THEN
      NULL;
    END;
    BEGIN
      DELETE FROM auth.sessions WHERE user_id = _user_id;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  ELSE
    BEGIN
      UPDATE auth.users SET banned_until = NULL WHERE id = _user_id;
    EXCEPTION WHEN undefined_column OR undefined_table THEN
      NULL;
    END;
  END IF;
END;
$body$;

REVOKE ALL ON FUNCTION public.set_auth_login_blocked(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_auth_login_blocked(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._caller_can_manage_accounts()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_master(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.project_members
       WHERE user_id = auth.uid()
         AND role_new = 'project_admin'::public.project_role
    )
  );
$body$;

REVOKE ALL ON FUNCTION public._caller_can_manage_accounts() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.retire_user_account(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _open record;
  _next_id uuid;
  _cancelled int := 0;
BEGIN
  IF NOT public._caller_can_manage_accounts() THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'USER_REQUIRED');
  END IF;
  IF _user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'CANNOT_RETIRE_SELF');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'master'::public.global_role
  ) AND (
    SELECT COUNT(*) FROM public.user_roles WHERE role = 'master'::public.global_role
  ) <= 1 THEN
    RETURN jsonb_build_object('error', 'LAST_MASTER');
  END IF;

  UPDATE public.profiles
     SET account_status = 'inactive', updated_at = now()
   WHERE user_id = _user_id;

  PERFORM public.set_auth_login_blocked(_user_id, true);

  FOR _open IN
    SELECT id, entity_type, entity_id, approval_version, step_order, status
      FROM public.approvals
     WHERE approver_id = _user_id
       AND status IN ('대기', '진행중')
  LOOP
    UPDATE public.approvals
       SET status = '취소',
           comment = CASE
             WHEN COALESCE(btrim(comment), '') = '' THEN '계정 로그인 차단'
             ELSE comment || ' [계정 로그인 차단]'
           END,
           updated_at = now()
     WHERE id = _open.id;
    _cancelled := _cancelled + 1;

    IF _open.status = '진행중' THEN
      SELECT a.id INTO _next_id
        FROM public.approvals a
       WHERE a.entity_type = _open.entity_type
         AND a.entity_id = _open.entity_id
         AND a.approval_version IS NOT DISTINCT FROM _open.approval_version
         AND a.status = '대기'
         AND a.step_order > _open.step_order
       ORDER BY a.step_order ASC
       LIMIT 1;
      IF _next_id IS NOT NULL THEN
        UPDATE public.approvals SET status = '진행중', updated_at = now() WHERE id = _next_id;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE user_id = auth.uid()),
    '계정로그인차단',
    'profile',
    _user_id::text,
    jsonb_build_object('cancelled_open_approvals', _cancelled)
  );

  RETURN jsonb_build_object('ok', true, 'cancelled_open_approvals', _cancelled);
END;
$body$;

CREATE OR REPLACE FUNCTION public.reactivate_user_account(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  IF NOT public._caller_can_manage_accounts() THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'USER_REQUIRED');
  END IF;

  UPDATE public.profiles
     SET account_status = 'active', updated_at = now()
   WHERE user_id = _user_id;

  PERFORM public.set_auth_login_blocked(_user_id, false);

  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    auth.uid(),
    (SELECT display_name FROM public.profiles WHERE user_id = auth.uid()),
    '계정재활성화',
    'profile',
    _user_id::text,
    '{}'::jsonb
  );

  RETURN jsonb_build_object('ok', true);
END;
$body$;

REVOKE ALL ON FUNCTION public.retire_user_account(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reactivate_user_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retire_user_account(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_user_account(uuid) TO authenticated, service_role;

-- Pending reject also blocks login (same leftover-account risk).
CREATE OR REPLACE FUNCTION public.reject_pending_user(
  _user_id uuid,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED';
  END IF;
  IF NOT public._caller_can_manage_accounts() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  UPDATE public.profiles
     SET account_status = 'inactive', updated_at = now()
   WHERE user_id = _user_id;

  PERFORM public.set_auth_login_blocked(_user_id, true);

  INSERT INTO public.audit_logs (user_id, user_name, action, target_type, target_id, details)
  VALUES (
    _caller,
    (SELECT display_name FROM public.profiles WHERE user_id = _caller),
    '가입반려',
    'profile',
    _user_id::text,
    jsonb_build_object('reason', btrim(_reason))
  );

  RETURN jsonb_build_object('ok', true);
END;
$body$;

REVOKE ALL ON FUNCTION public.reject_pending_user(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_pending_user(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.signup_identity_available(
  _email text DEFAULT NULL,
  _phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
DECLARE
  _digits text;
  _em text;
BEGIN
  _digits := public.normalize_phone_digits(_phone);
  _em := lower(trim(COALESCE(_email, '')));

  IF length(COALESCE(_digits, '')) >= 10 THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE public.normalize_phone_digits(p.phone) = _digits
         AND COALESCE(p.account_status, 'active') IN ('active', 'pending', 'inactive')
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'PHONE_IN_USE');
    END IF;
  END IF;

  IF _em <> '' THEN
    IF EXISTS (
      SELECT 1 FROM auth.users u WHERE lower(trim(COALESCE(u.email, ''))) = _em
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_IN_USE');
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$body$;

REVOKE ALL ON FUNCTION public.signup_identity_available(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signup_identity_available(text, text) TO anon, authenticated, service_role;

-- Approver picker: skip retired accounts
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
AS $body$
BEGIN
  IF NOT public.is_project_member(auth.uid(), _project_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH RECURSIVE
  ancestors AS (
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
    AND COALESCE(pr.account_status, 'active') = 'active'
    AND (
      pm.role_new::text IN (
        'project_admin', 'safety_manager', 'site_manager',
        'supervisor', 'site_supervisor', 'contractor'
      )
      OR pm.position_new IS NOT NULL
    );
END;
$body$;

CREATE OR REPLACE FUNCTION public.get_my_pending_entity_approvals()
RETURNS TABLE(
  approval_id uuid, entity_type text, entity_id uuid, project_id uuid,
  step text, step_order integer, step_position text,
  created_at timestamp with time zone, entity_title text, entity_date date
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $body$
  SELECT a.id, a.entity_type, a.entity_id, a.project_id,
         a.step, a.step_order, a.position AS step_position, a.created_at,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.title
           WHEN a.entity_type='work_permit'    THEN COALESCE(NULLIF(per.work_name,''), per.work_description, '작업허가서')
           WHEN a.entity_type='assessment_run' THEN ar.period_label
           ELSE '' END AS entity_title,
         CASE
           WHEN a.entity_type='work_plan'      THEN wp.start_date
           WHEN a.entity_type='work_permit'    THEN per.permit_date
           WHEN a.entity_type='assessment_run' THEN ar.start_date
           ELSE NULL END AS entity_date
    FROM public.approvals a
    LEFT JOIN public.work_plans      wp  ON a.entity_type='work_plan'      AND wp.id  = a.entity_id
    LEFT JOIN public.work_permits    per ON a.entity_type='work_permit'    AND per.id = a.entity_id
    LEFT JOIN public.assessment_runs ar  ON a.entity_type='assessment_run' AND ar.id  = a.entity_id
   WHERE a.status='진행중' AND a.entity_type IS NOT NULL
     AND public.account_is_active(auth.uid())
     AND (a.approver_id = auth.uid()
          OR (a.approver_id IS NULL AND public.is_project_admin(auth.uid(), a.project_id)))
   ORDER BY
     CASE WHEN lower(COALESCE(a.position,'')) = 'closure_sm' THEN 0 ELSE 1 END,
     a.created_at DESC;
$body$;

CREATE OR REPLACE FUNCTION public.trg_block_inactive_approval_act()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $body$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = '진행중'
     AND NEW.status IN ('승인', '반려')
     AND auth.uid() IS NOT NULL
     AND NOT public.account_is_active(auth.uid()) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE';
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_block_inactive_approval_act ON public.approvals;
CREATE TRIGGER trg_block_inactive_approval_act
BEFORE UPDATE OF status ON public.approvals
FOR EACH ROW
EXECUTE FUNCTION public.trg_block_inactive_approval_act();
