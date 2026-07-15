
-- ============================================================
-- Sprint: RA→WP→Permit cascade + TBM guard + Permit expiry + Invite hardening
-- ============================================================

-- 1) Cascade permit lock on work_plan final approval
CREATE OR REPLACE FUNCTION public.act_on_entity_approval(
  _approval_id uuid, _action text, _comment text DEFAULT ''::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _a record; _next record; _now timestamptz := now();
  _all_done boolean; _creator uuid;
  _entity_label text; _entity_link text;
  _plan_id uuid;
BEGIN
  SELECT * INTO _a FROM public.approvals WHERE id=_approval_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','NOT_FOUND'); END IF;
  IF _a.status <> '진행중' THEN RETURN jsonb_build_object('error','NOT_PENDING'); END IF;
  IF _a.approver_id IS NOT NULL AND _a.approver_id <> auth.uid() THEN
    RETURN jsonb_build_object('error','NOT_AUTHORIZED');
  END IF;
  IF _action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('error','INVALID_ACTION');
  END IF;

  _entity_label := CASE _a.entity_type
    WHEN 'work_plan' THEN '작업계획서' WHEN 'work_permit' THEN '작업허가서'
    WHEN 'assessment_run' THEN '위험성평가' WHEN 'safety_cost' THEN '산업안전보건관리비'
    WHEN 'incident' THEN '사고보고' WHEN 'emergency_drill' THEN '비상대피훈련'
    WHEN 'tbm' THEN 'TBM 일지' ELSE _a.entity_type END;
  _entity_link := CASE _a.entity_type
    WHEN 'work_plan' THEN '/work-plans' WHEN 'work_permit' THEN '/work-permits'
    WHEN 'assessment_run' THEN '/assessment-run/'||COALESCE(_a.entity_id::text,'')
    WHEN 'safety_cost' THEN '/safety-cost' WHEN 'incident' THEN '/incidents'
    WHEN 'emergency_drill' THEN '/emergency-drills' WHEN 'tbm' THEN '/tbm-logs'
    ELSE '/approvals' END;

  UPDATE public.approvals
     SET status = CASE WHEN _action='approve' THEN '승인' ELSE '반려' END,
         comment = COALESCE(_comment,''), approved_at=_now, updated_at=_now
   WHERE id=_approval_id;

  IF _action='reject' THEN
    UPDATE public.approvals SET status='취소', updated_at=_now
     WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
       AND approval_version=_a.approval_version AND status IN ('대기','진행중');

    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='반려', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='반려', rejection_reason=COALESCE(_comment,''), updated_at=_now
       WHERE id=_a.entity_id RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='rejected', updated_at=_now
         WHERE id=_a.entity_id RETURNING created_by INTO _creator;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;

    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result', _entity_label||' 반려',
              COALESCE(_comment,'결재가 반려되었습니다.'), _entity_link);
    END IF;
    RETURN jsonb_build_object('success', true, 'action','rejected');
  END IF;

  SELECT * INTO _next FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version AND status='대기' AND step_order>_a.step_order
   ORDER BY step_order ASC LIMIT 1;

  IF FOUND THEN
    UPDATE public.approvals SET status='진행중', updated_at=_now WHERE id=_next.id;
    IF _next.approver_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_next.approver_id, 'approval_request', _entity_label||' 결재 요청',
              '결재가 필요합니다.', _entity_link);
    END IF;
    RETURN jsonb_build_object('success', true, 'action','forwarded');
  END IF;

  SELECT bool_and(status='승인') INTO _all_done FROM public.approvals
   WHERE entity_type=_a.entity_type AND entity_id=_a.entity_id
     AND approval_version=_a.approval_version;

  IF _all_done THEN
    IF _a.entity_type='work_plan' THEN
      UPDATE public.work_plans SET status='승인', updated_at=_now WHERE id=_a.entity_id
        RETURNING created_by, id INTO _creator, _plan_id;
      -- CASCADE: 연결된 허가서 자동 잠금
      IF _plan_id IS NOT NULL THEN
        UPDATE public.work_permits
           SET status = CASE WHEN status IN ('승인','반려') THEN status ELSE '승인' END,
               approved_at = COALESCE(approved_at, _now),
               updated_at = _now
         WHERE work_plan_id = _plan_id
           AND COALESCE(status,'') NOT IN ('승인','반려');
      END IF;
    ELSIF _a.entity_type='work_permit' THEN
      UPDATE public.work_permits SET status='승인', approved_at=_now, approved_by=auth.uid(),
             updated_at=_now WHERE id=_a.entity_id RETURNING created_by INTO _creator;
    ELSIF _a.entity_type='assessment_run' THEN
      BEGIN
        UPDATE public.assessment_runs SET status='approved', updated_at=_now
         WHERE id=_a.entity_id RETURNING created_by INTO _creator;
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    IF _creator IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (_creator, 'approval_result', _entity_label||' 최종 승인',
              '결재가 완료되었습니다.', _entity_link);
    END IF;
  END IF;
  RETURN jsonb_build_object('success', true, 'action','approved');
END; $$;
REVOKE EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.act_on_entity_approval(uuid, text, text) TO authenticated, service_role;


-- 2) Permit expiry notification tracking column
ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS expiry_notified_at TIMESTAMPTZ;
ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;

-- 3) TBM participation guard RPC (matches by worker phone since tbm_participations uses phone)
CREATE OR REPLACE FUNCTION public.worker_has_tbm_today(_worker_id uuid, _work_date date DEFAULT CURRENT_DATE)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tbm_participations p
      JOIN public.tbm_sessions s ON s.id = p.tbm_session_id
      JOIN public.workers w ON w.id = _worker_id
     WHERE s.tbm_date = _work_date
       AND s.project_id = w.project_id
       AND p.worker_phone = w.phone
       AND p.briefing_confirmed = true
  );
$$;
REVOKE EXECUTE ON FUNCTION public.worker_has_tbm_today(uuid, date) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.worker_has_tbm_today(uuid, date) TO anon, authenticated, service_role;


-- 4) Fix project_invites RLS — remove broad SELECT, replace with SECURITY DEFINER lookup
DROP POLICY IF EXISTS "Anyone can lookup invite by code" ON public.project_invites;
DROP POLICY IF EXISTS "Authenticated can lookup invite by code" ON public.project_invites;

-- Ensure a scoped SELECT policy exists (project admins/members only)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='project_invites'
       AND policyname='Project admins can view invites'
  ) THEN
    CREATE POLICY "Project admins can view invites"
      ON public.project_invites FOR SELECT TO authenticated
      USING (public.is_project_admin(auth.uid(), project_id));
  END IF;
END $$;

-- Safe RPC — return only minimal invite info to logged-in caller by exact code
CREATE OR REPLACE FUNCTION public.lookup_project_invite_by_code(_code text)
RETURNS TABLE(
  id uuid, project_id uuid, default_role text,
  expires_at timestamptz, max_uses integer, use_count integer,
  project_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT i.id, i.project_id, i.default_role::text,
         i.expires_at, i.max_uses, i.use_count,
         p.name AS project_name
    FROM public.project_invites i
    LEFT JOIN public.projects p ON p.id = i.project_id
   WHERE i.code = _code
     AND (i.expires_at IS NULL OR i.expires_at > now())
     AND (i.max_uses IS NULL OR COALESCE(i.use_count,0) < i.max_uses)
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.lookup_project_invite_by_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.lookup_project_invite_by_code(text) TO authenticated, service_role;


-- 5) Permit-expiry notification scanner (invoked by cron every 10 min)
CREATE OR REPLACE FUNCTION public.scan_permit_expiries()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _p record; _n integer := 0; _title text; _link text;
BEGIN
  FOR _p IN
    SELECT id, project_id, work_description, valid_until, created_by
      FROM public.work_permits
     WHERE COALESCE(status,'') = '승인'
       AND valid_until IS NOT NULL
       AND valid_until BETWEEN now() + interval '55 minutes' AND now() + interval '65 minutes'
       AND expiry_notified_at IS NULL
  LOOP
    _title := '작업허가서 만료 예정';
    _link  := '/work-permits';
    IF _p.created_by IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, project_id)
      VALUES (_p.created_by, 'permit_expiry', _title,
              COALESCE(_p.work_description,'허가서') || ' 유효기간이 1시간 뒤 종료됩니다. 연장 또는 종료를 확인하세요.',
              _link, _p.project_id);
      _n := _n + 1;
    END IF;
    UPDATE public.work_permits SET expiry_notified_at = now() WHERE id = _p.id;
  END LOOP;
  RETURN _n;
END; $$;
REVOKE EXECUTE ON FUNCTION public.scan_permit_expiries() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.scan_permit_expiries() TO authenticated, service_role;
