## 문제 원인

### 1. 사용자 승인 실패 — `type "app_role" does not exist`
`approve_pending_user` RPC 내부에서 잘못된 타입 캐스팅을 사용 중:
- `public.has_role(_caller, 'master'::app_role)` → 실제 enum은 `global_role`
- `'user'::project_role` → `project_role` enum 에는 `user` 값이 없음 (worker/viewer/supervisor/site_manager/safety_manager/project_admin 만 존재)

이 두 캐스팅이 실행되는 순간 함수 전체가 실패 → "type 'app_role' does not exist" 토스트.

### 2. 일반 사용자(감리/감독 등) 메뉴 전면 차단
`src/pages/PermissionTest.tsx` 의 `menuPermissions` / `actionPermissions` 매트릭스에 `supervisor`(감리/감독) 및 `site_manager` 역할이 대부분 누락되어 있어, 실제 사이드바 라우팅과 다르게 "접근 불가"로 표시되고, 몇몇 화면(권한 점검, 전자결재 진입 등)에서 실제로도 차단됨. `useProjectAccess`(SSOT)는 이미 supervisor/site_manager 권한을 정의하고 있으므로 매트릭스만 SSOT에 맞춰 정정하면 됨.

---

## 수정 계획

### A. 마이그레이션 — `approve_pending_user` RPC 재작성
- `'master'::app_role` → `'master'::global_role` 로 교체
- 기본 매핑 fallback을 `'user'::project_role` → `'viewer'::project_role` 로 교체 (enum 에 없는 값 제거)
- 승격 조건(`_mem.role_new = 'user'::project_role`)도 제거하고 viewer/NULL 만 대상으로 함
- `reject_pending_user` 도 동일 점검(같은 파일에 있을 경우 함께 수정)
- 함수 재정의 후 `GRANT EXECUTE ... TO authenticated` 유지

### B. `src/pages/PermissionTest.tsx` — 역할 매트릭스 SSOT 정합화
`useProjectAccess.PERMISSION_MATRIX` 에 맞춰 `menuPermissions` / `actionPermissions` 에 `supervisor`, `site_manager`, `worker` 추가:
- 대시보드/프로젝트/전자결재/TBM 기록: 모든 프로젝트 역할 허용 (master, project_admin, safety_manager, site_manager, supervisor, worker, viewer)
- 위험성평가/작업계획서/작업허가서: master, project_admin, safety_manager, site_manager, supervisor, worker (viewer 는 조회만)
- 검증센터/기준정보/감사로그: master, project_admin, safety_manager
- 사용자 관리: master, project_admin
- 권한 점검: master
- 기능별 권한도 SSOT 매트릭스의 create/edit/approve 값을 그대로 반영

### C. 검증
- 마이그레이션 실행 후 UI 에서 "승인" 클릭 → 성공 토스트 확인
- `/permissions` 페이지에서 정대용(감리/감독) 선택 시 전자결재/TBM 등 "접근 가능" 으로 표시되는지 확인

---

## 기술 세부

```sql
CREATE OR REPLACE FUNCTION public.approve_pending_user(
  _user_id uuid,
  _override_role project_role DEFAULT NULL
) RETURNS jsonb ... AS $$
...
  SELECT (public.has_role(_caller, 'master'::global_role)
          OR EXISTS (SELECT 1 FROM public.project_members
                     WHERE user_id = _caller AND role_new = 'project_admin'))
  INTO _is_admin;
...
    _mapped := COALESCE(
      _override_role,
      CASE
        WHEN _mem.position_new::text IN ('site_manager','safety_manager','HSE_MANAGER','SITE_MANAGER')
          THEN 'safety_manager'::project_role
        WHEN _mem.position_new::text IN ('inspector','SUPERVISOR')
          THEN 'supervisor'::project_role
        ELSE 'viewer'::project_role
      END
    );
    IF _override_role IS NOT NULL
       OR _mem.role_new IS NULL
       OR _mem.role_new = 'viewer'::project_role THEN
       UPDATE public.project_members SET role_new = _mapped WHERE id = _mem.id;
       _touched := _touched + 1;
    END IF;
...
$$;
```

파일 변경:
- `supabase/migrations/*` (신규) — 위 RPC 재정의
- `src/pages/PermissionTest.tsx` — 매트릭스에 supervisor/site_manager/worker 추가
