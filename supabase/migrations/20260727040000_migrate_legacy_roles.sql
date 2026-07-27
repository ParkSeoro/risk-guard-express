-- =============================================================================
-- migrate_legacy_roles: 레거시 권한 → 최신 project_role / project_position
-- =============================================================================
-- 작성 목적:
--   1) project_members.role_new 의 contractor/user 등 구형 값을 worker 등으로 정규화
--   2) position_new / profiles.position 소문자·별칭 → project_position 대문자 enum
--   3) 발주처(client) 안전/현장 직책을 OWNER_HSE / OWNER_PM 으로 보정
--      (결재선 owner_sm / owner_cm 필터가 safety_manager 혼입을 막도록)
--   4) approval_lines.position 레거시 키를 5단계 SSOT 키로 최대한 변환
--
-- 안전장치:
--   - _legacy_role_backup_* 테이블에 변경 전 스냅샷 저장 (롤백용)
--   - 트랜잭션 블록
--   - 롤백 절차는 파일 하단 주석 참고
--
-- 매핑 전략 상세: src/lib/legacyRoleMapping.ts 주석 참고
-- =============================================================================

BEGIN;

-- ─── 0) 백업 테이블 (이미 있으면면 덮어쓰지 않음 — 최초 실행 스냅샷 보존) ───
CREATE TABLE IF NOT EXISTS public._legacy_role_backup_project_members (
  backup_at timestamptz NOT NULL DEFAULT now(),
  id uuid,
  user_id uuid,
  project_id uuid,
  company_id uuid,
  role_new text,
  position_new text
);

CREATE TABLE IF NOT EXISTS public._legacy_role_backup_profiles (
  backup_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  position text
);

CREATE TABLE IF NOT EXISTS public._legacy_role_backup_approval_lines (
  backup_at timestamptz NOT NULL DEFAULT now(),
  id uuid,
  project_id uuid,
  position text,
  step_order int,
  approver_id uuid
);

CREATE TABLE IF NOT EXISTS public._legacy_role_backup_user_roles (
  backup_at timestamptz NOT NULL DEFAULT now(),
  id uuid,
  user_id uuid,
  role text
);

-- 최초 1회만 스냅샷 (행이 없으면 현재 상태 적재)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._legacy_role_backup_project_members LIMIT 1) THEN
    INSERT INTO public._legacy_role_backup_project_members (id, user_id, project_id, company_id, role_new, position_new)
    SELECT id, user_id, project_id, company_id, role_new::text, position_new::text
    FROM public.project_members;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public._legacy_role_backup_profiles LIMIT 1) THEN
    INSERT INTO public._legacy_role_backup_profiles (user_id, position)
    SELECT user_id, position FROM public.profiles;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public._legacy_role_backup_approval_lines LIMIT 1) THEN
    INSERT INTO public._legacy_role_backup_approval_lines (id, project_id, position, step_order, approver_id)
    SELECT id, project_id, position, step_order, approver_id FROM public.approval_lines;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public._legacy_role_backup_user_roles LIMIT 1) THEN
    INSERT INTO public._legacy_role_backup_user_roles (id, user_id, role)
    SELECT id, user_id, role::text FROM public.user_roles;
  END IF;
END $$;

-- ─── 1) project_members.role_new : 레거시 → 최신 ───────────────────────────
-- NOTE: project_role enum 에 contractor/user 가 없을 수 있어 text 캐스팅 후 갱신.
--       enum 에 없는 값이 이미 들어 있으면 ALTER 가 필요할 수 있음 → 안전 분기.

DO $$
DECLARE
  has_contractor boolean;
BEGIN
  -- role_new 가 text 유사하거나 enum 멤버에 레거시가 남아있는 경우 대비
  UPDATE public.project_members pm
  SET role_new = 'worker'::public.project_role
  WHERE pm.role_new::text IN ('contractor', 'user', 'WORKER', 'Contractor');

  -- inspector → supervisor
  UPDATE public.project_members pm
  SET role_new = 'supervisor'::public.project_role
  WHERE pm.role_new::text IN ('inspector', 'Inspector');

EXCEPTION
  WHEN invalid_text_representation OR datatype_mismatch THEN
    -- enum 캐스팅 실패 시: 존재하는 행만 text 비교로 스킵 로그
    RAISE NOTICE 'legacy role_new UPDATE skipped or partial: %', SQLERRM;
END $$;

-- ─── 2) position_new : 소문자/별칭 → project_position + 발주처 보정 ─────────
-- 2a) 이미 대문자인 HSE/SITE 를 client 회사에서 OWNER_* 로
UPDATE public.project_members pm
SET position_new = 'OWNER_HSE'::public.project_position
FROM public.companies c
WHERE pm.company_id = c.id
  AND lower(c.type) = 'client'
  AND pm.position_new::text IN ('HSE_MANAGER', 'hse_manager', 'safety_manager');

UPDATE public.project_members pm
SET position_new = 'OWNER_PM'::public.project_position
FROM public.companies c
WHERE pm.company_id = c.id
  AND lower(c.type) = 'client'
  AND pm.position_new::text IN ('SITE_MANAGER', 'site_manager');

-- 2b) 소문자·별칭 일반 매핑 (회사 타입 무관 / contractor·gc)
UPDATE public.project_members pm
SET position_new = CASE lower(pm.position_new::text)
  WHEN 'safety_manager' THEN 'HSE_MANAGER'::public.project_position
  WHEN 'hse_manager' THEN 'HSE_MANAGER'::public.project_position
  WHEN 'sm' THEN 'HSE_MANAGER'::public.project_position
  WHEN 'site_manager' THEN 'SITE_MANAGER'::public.project_position
  WHEN 'supervisor' THEN 'SUPERVISOR'::public.project_position
  WHEN 'inspector' THEN 'SUPERVISOR'::public.project_position
  WHEN 'foreman' THEN 'FOREMAN'::public.project_position
  WHEN 'worker' THEN 'WORKER'::public.project_position
  WHEN 'construction_mgr' THEN 'CONSTRUCTION_MGR'::public.project_position
  WHEN 'construction_manager' THEN 'CONSTRUCTION_MGR'::public.project_position
  WHEN 'field_engineer' THEN 'FIELD_ENGINEER'::public.project_position
  WHEN 'ceo' THEN 'CEO'::public.project_position
  WHEN 'executive' THEN 'EXECUTIVE'::public.project_position
  WHEN 'manager' THEN 'EXECUTIVE'::public.project_position
  WHEN 'cm' THEN 'OWNER_PM'::public.project_position
  WHEN 'owner_pm' THEN 'OWNER_PM'::public.project_position
  WHEN 'owner_hse' THEN 'OWNER_HSE'::public.project_position
  ELSE pm.position_new
END
WHERE pm.position_new IS NOT NULL
  AND lower(pm.position_new::text) IN (
    'safety_manager','hse_manager','sm','site_manager','supervisor','inspector',
    'foreman','worker','construction_mgr','construction_manager','field_engineer',
    'ceo','executive','manager','cm','owner_pm','owner_hse'
  );

-- client 재보정 (소문자→대문자 변환 후)
UPDATE public.project_members pm
SET position_new = 'OWNER_HSE'::public.project_position
FROM public.companies c
WHERE pm.company_id = c.id
  AND lower(c.type) = 'client'
  AND pm.position_new::text = 'HSE_MANAGER';

UPDATE public.project_members pm
SET position_new = 'OWNER_PM'::public.project_position
FROM public.companies c
WHERE pm.company_id = c.id
  AND lower(c.type) = 'client'
  AND pm.position_new::text = 'SITE_MANAGER';

-- gc 발주처 SM 후보: HSE_MANAGER 유지 (owner_sm 필터가 gc+HSE_MANAGER 허용)
-- client 만 OWNER_HSE 강제

-- ─── 3) profiles.position 정규화 (표시용, enum 아님 text) ───────────────────
UPDATE public.profiles p
SET position = CASE lower(coalesce(p.position, ''))
  WHEN 'safety_manager' THEN 'HSE_MANAGER'
  WHEN 'site_manager' THEN 'SITE_MANAGER'
  WHEN 'supervisor' THEN 'SUPERVISOR'
  WHEN 'inspector' THEN 'SUPERVISOR'
  WHEN 'foreman' THEN 'FOREMAN'
  WHEN 'worker' THEN 'WORKER'
  WHEN 'construction_mgr' THEN 'CONSTRUCTION_MGR'
  WHEN 'field_engineer' THEN 'FIELD_ENGINEER'
  WHEN 'cm' THEN 'OWNER_PM'
  WHEN 'sm' THEN 'OWNER_HSE'
  ELSE p.position
END
WHERE p.position IS NOT NULL
  AND lower(p.position) IN (
    'safety_manager','site_manager','supervisor','inspector','foreman','worker',
    'construction_mgr','field_engineer','cm','sm'
  );

-- ─── 4) approval_lines.position → 5단계 SSOT 키 ────────────────────────────
-- 회사 문맥이 없는 행: safety_manager 는 모호 → contractor_safety_manager 로
-- 두지 않고, approver 의 company.type 으로 분기.

UPDATE public.approval_lines al
SET position = CASE
  WHEN lower(al.position) IN ('supervisor', 'contractor_pic', 'foreman')
    THEN 'contractor_supervisor'
  WHEN lower(al.position) IN ('site_director')
    THEN 'contractor_site_director'
  WHEN lower(al.position) IN ('project_admin', 'cm', 'owner_pm', 'construction_mgr')
    THEN 'owner_cm'
  WHEN lower(al.position) IN ('sm', 'owner_hse')
    THEN 'owner_sm'
  WHEN lower(al.position) IN ('cooperator', '협조')
    THEN 'cooperator'
  ELSE al.position
END
WHERE lower(al.position) IN (
  'supervisor','contractor_pic','foreman','site_director',
  'project_admin','cm','owner_pm','construction_mgr','sm','owner_hse','cooperator','협조'
);

-- safety_manager / site_manager : 결재자 회사 타입으로 분기
UPDATE public.approval_lines al
SET position = CASE
  WHEN lower(coalesce(c.type, '')) IN ('client', 'gc') THEN 'owner_sm'
  WHEN lower(coalesce(c.type, '')) IN ('contractor', 'vendor') THEN 'contractor_safety_manager'
  ELSE al.position  -- 불명: 그대로 두고 FE 가 차단
END
FROM public.project_members pm
LEFT JOIN public.companies c ON c.id = pm.company_id
WHERE al.approver_id = pm.user_id
  AND al.project_id = pm.project_id
  AND lower(al.position) IN ('safety_manager', 'safety_pic', 'hse_manager');

UPDATE public.approval_lines al
SET position = CASE
  WHEN lower(coalesce(c.type, '')) = 'client' THEN 'owner_cm'
  WHEN lower(coalesce(c.type, '')) IN ('contractor', 'vendor') THEN 'contractor_site_director'
  WHEN lower(coalesce(c.type, '')) = 'gc' THEN 'owner_cm'
  ELSE al.position
END
FROM public.project_members pm
LEFT JOIN public.companies c ON c.id = pm.company_id
WHERE al.approver_id = pm.user_id
  AND al.project_id = pm.project_id
  AND lower(al.position) = 'site_manager';

-- ─── 5) user_roles : global_role 이 아닌 레거시 행 정리 ─────────────────────
-- 최신 스키마에서 user_roles.role 은 global_role(master) 만 허용.
-- 혹시 text/구 enum 잔여가 있으면 비-master 는 백업 후 삭제 (프로젝트 권한은 project_members).
DO $$
BEGIN
  DELETE FROM public.user_roles
  WHERE role::text NOT IN ('master');
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'user_roles cleanup skipped: %', SQLERRM;
END $$;

-- ─── 6) 검증 뷰(선택): 마이그레이션 후 점검용 ───────────────────────────────
CREATE OR REPLACE VIEW public._legacy_role_migration_report AS
SELECT
  'project_members_legacy_role' AS check_name,
  count(*)::int AS hit_count
FROM public.project_members
WHERE role_new::text IN ('contractor', 'user', 'inspector')
UNION ALL
SELECT
  'project_members_lowercase_position',
  count(*)::int
FROM public.project_members
WHERE position_new IS NOT NULL
  AND position_new::text ~ '[a-z]'
UNION ALL
SELECT
  'client_hse_not_owner',
  count(*)::int
FROM public.project_members pm
JOIN public.companies c ON c.id = pm.company_id
WHERE lower(c.type) = 'client'
  AND pm.position_new::text = 'HSE_MANAGER'
UNION ALL
SELECT
  'approval_lines_legacy_position',
  count(*)::int
FROM public.approval_lines
WHERE lower(position) IN (
  'safety_manager','site_manager','supervisor','project_admin','contractor','worker'
);

COMMIT;

-- =============================================================================
-- ROLLBACK (수동 실행)
-- -----------------------------------------------------------------------------
-- BEGIN;
--
-- UPDATE public.project_members pm SET
--   role_new = b.role_new::public.project_role,
--   position_new = NULLIF(b.position_new, '')::public.project_position
-- FROM public._legacy_role_backup_project_members b
-- WHERE pm.id = b.id
--   AND b.backup_at = (SELECT min(backup_at) FROM public._legacy_role_backup_project_members);
--
-- UPDATE public.profiles p SET position = b.position
-- FROM public._legacy_role_backup_profiles b
-- WHERE p.user_id = b.user_id
--   AND b.backup_at = (SELECT min(backup_at) FROM public._legacy_role_backup_profiles);
--
-- UPDATE public.approval_lines al SET position = b.position
-- FROM public._legacy_role_backup_approval_lines b
-- WHERE al.id = b.id
--   AND b.backup_at = (SELECT min(backup_at) FROM public._legacy_role_backup_approval_lines);
--
-- -- user_roles 복원은 스키마(global_role)에 맞지 않는 행이 있을 수 있음 → 선별 복원
-- -- INSERT INTO public.user_roles (user_id, role)
-- -- SELECT user_id, 'master'::public.global_role FROM public._legacy_role_backup_user_roles
-- -- WHERE role = 'master' ON CONFLICT DO NOTHING;
--
-- COMMIT;
--
-- 백업 테이블 삭제(확정 후):
-- DROP VIEW IF EXISTS public._legacy_role_migration_report;
-- DROP TABLE IF EXISTS public._legacy_role_backup_project_members;
-- DROP TABLE IF EXISTS public._legacy_role_backup_profiles;
-- DROP TABLE IF EXISTS public._legacy_role_backup_approval_lines;
-- DROP TABLE IF EXISTS public._legacy_role_backup_user_roles;
-- =============================================================================
