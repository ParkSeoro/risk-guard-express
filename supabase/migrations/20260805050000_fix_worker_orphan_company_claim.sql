-- Workers with company_id NULL (legacy manual rows) were invisible under
-- company-scoped roster filters, and site managers could not UPDATE them
-- (can_access_safety_cost(NULL)=false → silent 0-row updates).
-- Company-agnostic claim: any project manager may adopt an orphan into
-- their company when company_name matches (normalized) or is empty.

CREATE OR REPLACE FUNCTION public.normalize_company_label(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  -- Strip corp suffixes first so 'Acme(주)' and 'Acme㈜' both → 'acme'
  SELECT regexp_replace(
    regexp_replace(
      lower(trim(COALESCE(_name, ''))),
      '㈜|㈔|㈐|\(\s*주\s*\)|\(\s*유\s*\)|\(\s*합\s*\)|주식회사|유한회사|합자회사',
      '',
      'g'
    ),
    '[^0-9a-z가-힣]+',
    '',
    'g'
  );
$function$;

CREATE OR REPLACE FUNCTION public.normalize_phone_digits(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
$function$;

-- Align safety-cost helper: NULL company_id = project-scoped write for managers
CREATE OR REPLACE FUNCTION public.can_access_safety_cost(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _role public.project_role;
BEGIN
  IF _user_id IS NULL OR _project_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.is_master(_user_id) THEN
    RETURN true;
  END IF;

  SELECT role_new INTO _role
  FROM public.project_members
  WHERE user_id = _user_id AND project_id = _project_id
  LIMIT 1;
  IF _role IS NULL THEN
    RETURN false;
  END IF;

  IF _role IN ('project_admin', 'safety_manager') THEN
    RETURN true;
  END IF;
  IF _write AND _role = 'viewer' THEN
    RETURN false;
  END IF;

  -- Project-scoped / orphan rows: manager roles may read+write
  IF _company_id IS NULL THEN
    RETURN _role IN (
      'project_admin', 'safety_manager',
      'site_manager', 'supervisor', 'site_supervisor'
    );
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.user_id = _user_id
      AND pm.project_id = _project_id
      AND pm.company_id = _company_id
  );
END;
$function$;

-- Workers write path: same SSOT as other company modules
DROP POLICY IF EXISTS workers_insert_admin ON public.workers;
CREATE POLICY workers_insert_admin ON public.workers
FOR INSERT TO authenticated
WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

DROP POLICY IF EXISTS workers_update_admin ON public.workers;
CREATE POLICY workers_update_admin ON public.workers
FOR UPDATE TO authenticated
USING (public.can_write_company_data(auth.uid(), project_id, company_id))
WITH CHECK (public.can_write_company_data(auth.uid(), project_id, company_id));

DROP POLICY IF EXISTS workers_delete_admin ON public.workers;
CREATE POLICY workers_delete_admin ON public.workers
FOR DELETE TO authenticated
USING (public.can_write_company_data(auth.uid(), project_id, company_id));

/**
 * Bulk upsert by (project_id, phone digits).
 * - insert when missing
 * - update when same/accessible company
 * - claim company_id NULL orphans when company_name empty or label-matches
 * Returns { inserted, updated, claimed, failed: [{phone, error}] }
 */
CREATE OR REPLACE FUNCTION public.upsert_project_workers_bulk(
  _project_id uuid,
  _company_id uuid,
  _company_name text,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r jsonb;
  v_name text;
  v_phone text;
  v_digits text;
  v_job text;
  v_birth date;
  v_hire date;
  v_existing public.workers%ROWTYPE;
  v_inserted int := 0;
  v_updated int := 0;
  v_claimed int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_label text := public.normalize_company_label(_company_name);
  v_exist_label text;
  v_can_touch boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF _project_id IS NULL OR _company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'PROJECT_OR_COMPANY_REQUIRED');
  END IF;
  IF NOT public.can_write_company_data(v_uid, _project_id, _company_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error', 'ROWS_MUST_BE_ARRAY');
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb))
  LOOP
    BEGIN
      v_name := nullif(trim(COALESCE(r->>'name', '')), '');
      v_phone := nullif(trim(COALESCE(r->>'phone', '')), '');
      v_digits := public.normalize_phone_digits(v_phone);
      v_job := nullif(trim(COALESCE(r->>'job_type', '')), '');
      v_birth := NULLIF(r->>'birth_date', '')::date;
      v_hire := NULLIF(r->>'hire_date', '')::date;

      IF v_name IS NULL OR length(v_digits) < 9 OR v_job IS NULL THEN
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'phone', v_phone, 'error', 'INVALID_ROW'
        ));
        CONTINUE;
      END IF;

      -- Prefer hyphen form 010-XXXX-XXXX when 11 digits
      IF length(v_digits) = 11 AND v_digits LIKE '010%' THEN
        v_phone := substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 4) || '-' || substr(v_digits, 8, 4);
      END IF;

      SELECT * INTO v_existing
      FROM public.workers w
      WHERE w.project_id = _project_id
        AND public.normalize_phone_digits(w.phone) = v_digits
      ORDER BY CASE WHEN w.company_id = _company_id THEN 0
                    WHEN w.company_id IS NULL THEN 1
                    ELSE 2 END,
               w.created_at ASC
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.workers (
          project_id, company_id, company_name, name, phone, job_type,
          birth_date, hire_date, is_active, qr_token
        ) VALUES (
          _project_id, _company_id, COALESCE(nullif(trim(_company_name), ''), ''),
          v_name, v_phone, v_job, v_birth, v_hire, true, encode(gen_random_bytes(16), 'hex')
        );
        v_inserted := v_inserted + 1;
        CONTINUE;
      END IF;

      v_can_touch := false;
      IF v_existing.company_id IS NULL THEN
        v_exist_label := public.normalize_company_label(v_existing.company_name);
        -- Company-agnostic claim: empty label OR normalized name match only.
        -- No role bypass — prevents assigning another firm's orphans to the importer company.
        IF v_exist_label = '' OR v_exist_label = v_label THEN
          v_can_touch := true;
        END IF;
      ELSIF v_existing.company_id = _company_id THEN
        v_can_touch := true;
      ELSIF public.can_write_company_data(v_uid, _project_id, v_existing.company_id) THEN
        -- Elevated / tree access may update but keep existing company_id
        v_can_touch := true;
      END IF;

      IF NOT v_can_touch THEN
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'phone', v_phone,
          'error', 'OTHER_COMPANY',
          'existing_company_id', v_existing.company_id
        ));
        CONTINUE;
      END IF;

      UPDATE public.workers
         SET company_id = CASE
               WHEN company_id IS NULL THEN _company_id
               ELSE company_id
             END,
             company_name = CASE
               WHEN company_id IS NULL OR company_id = _company_id
                 THEN COALESCE(nullif(trim(_company_name), ''), company_name)
               ELSE company_name
             END,
             name = v_name,
             phone = v_phone,
             job_type = v_job,
             birth_date = COALESCE(v_birth, birth_date),
             hire_date = COALESCE(v_hire, hire_date),
             is_active = true,
             updated_at = now()
       WHERE id = v_existing.id;

      IF v_existing.company_id IS NULL THEN
        v_claimed := v_claimed + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'phone', r->>'phone',
        'error', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'claimed', v_claimed,
    'failed', v_failed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_company_label(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_phone_digits(text) TO authenticated, service_role;
