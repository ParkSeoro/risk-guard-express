-- Preview must see same-project other-company phones (RLS hid them).
-- Upsert returns ok_phones so login provision does not run for OTHER_COMPANY rows.

CREATE OR REPLACE FUNCTION public.list_project_worker_phone_hits(
  _project_id uuid,
  _phones text[]
)
RETURNS TABLE (
  phone_digits text,
  company_id uuid,
  company_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _project_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT (
    public.is_master(v_uid)
    OR public.is_project_member(v_uid, _project_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    public.normalize_phone_digits(w.phone),
    w.company_id,
    w.company_name
  FROM public.workers w
  WHERE w.project_id = _project_id
    AND public.normalize_phone_digits(w.phone) = ANY (
      SELECT public.normalize_phone_digits(p)
      FROM unnest(COALESCE(_phones, ARRAY[]::text[])) AS p
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_project_worker_phone_hits(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_project_worker_phone_hits(uuid, text[]) TO authenticated, service_role;

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
  v_ok_phones jsonb := '[]'::jsonb;
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
          birth_date, hire_date, is_active
        ) VALUES (
          _project_id, _company_id, COALESCE(nullif(trim(_company_name), ''), ''),
          v_name, v_phone, v_job, v_birth, v_hire, true
        );
        v_inserted := v_inserted + 1;
        v_ok_phones := v_ok_phones || jsonb_build_array(v_digits);
        CONTINUE;
      END IF;

      v_can_touch := false;
      IF v_existing.company_id IS NULL THEN
        v_exist_label := public.normalize_company_label(v_existing.company_name);
        IF v_exist_label = '' OR v_exist_label = v_label THEN
          v_can_touch := true;
        END IF;
      ELSIF v_existing.company_id = _company_id THEN
        v_can_touch := true;
      ELSIF public.can_write_company_data(v_uid, _project_id, v_existing.company_id) THEN
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
      v_ok_phones := v_ok_phones || jsonb_build_array(v_digits);
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
    'failed', v_failed,
    'ok_phones', v_ok_phones
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) TO authenticated, service_role;
