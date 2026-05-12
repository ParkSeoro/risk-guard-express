
# 권한 구조 DB 재설계 계획

## 1. 현재 구조 진단 (실측)

### 테이블 / 컬럼
```
user_roles      (id, user_id, role: app_role)                       — 3 master + 2 safety_manager + 1 project_admin
project_members (id, project_id, user_id, role: app_role,
                 company TEXT, company_id UUID, position TEXT)      — 8건 / company_id=NULL 8건(!)
profiles        (user_id, display_name, phone, company TEXT,
                 position TEXT, account_status)
companies       (id, project_id, type, name, parent_company_id …)
```

### app_role enum (현재)
`{master, project_admin, safety_manager, contractor, viewer, user}` ← 글로벌과 프로젝트 역할이 한 enum에 섞임

### 발견된 결정적 결함
| # | 문제 | 영향 |
|---|------|------|
| **B1** | `companies` RLS 정책에서 `get_project_role(project_id, auth.uid())` — 함수 시그니처는 `(_user_id, _project_id)`. **인수 순서가 뒤집힘** | 협력업체 격리가 사실상 무력화. project_admin이 회사를 만들지 못하거나, 잘못된 회사에 접근 가능 |
| **B2** | `user_roles`에 `safety_manager`, `project_admin` 같은 **프로젝트 역할**이 저장됨 | "전 프로젝트에서 PM"이 되는 권한 부풀림. `has_role()` 호출 시 글로벌 권한처럼 통과 |
| **B3** | `project_members.company_id`가 모두 NULL(8/8) | 협력업체 데이터 격리(`applyCompanyFilter`)가 실질 동작 안 함 |
| **B4** | `position`이 free-text(TEXT) — 결재선/조직매핑이 문자열 매칭 | 오타·표기차이로 결재선 매칭 실패 |
| **B5** | `profiles.company`/`profiles.position`이 프로젝트 무관한 단일 값 | 한 사용자가 프로젝트마다 회사/직책이 다를 수 없음 |
| **B6** | `project_members.company` TEXT vs `company_id` UUID 이중 저장 | SSOT 위반 (메모리의 Company Data SSOT 정책과 충돌) |

---

## 2. 목표 구조 (To-Be)

### 권한 모델 (3계층)

```
[Global]   user_roles            ─ master 만 허용 (시스템 전체 관리)
              │
[Project]  project_members       ─ 프로젝트 멤버십 + role + company_id + position
              │
[Company]  companies (type)      ─ client / gc / contractor 위계
```

### 새 enum 정의

```sql
-- 1) 글로벌 역할 (시스템 차원)
CREATE TYPE public.global_role AS ENUM ('master');

-- 2) 프로젝트 역할 (프로젝트 차원)
CREATE TYPE public.project_role AS ENUM (
  'project_admin',   -- 발주처 또는 PM (전권)
  'safety_manager',  -- 안전관리자 (등록·승인)
  'site_manager',    -- 현장소장 (등록·승인)
  'supervisor',      -- 감리/감독
  'worker',          -- 일반 작업자 (자기 회사 데이터만)
  'viewer'           -- 읽기 전용
);

-- 3) 직책 (결재선·조직매핑용)
CREATE TYPE public.project_position AS ENUM (
  'CEO',              -- 대표이사
  'EXECUTIVE',        -- 임원
  'SITE_MANAGER',     -- 현장소장
  'HSE_MANAGER',      -- 안전관리자
  'CONSTRUCTION_MGR', -- 공사부장
  'FIELD_ENGINEER',   -- 공사담당
  'FOREMAN',          -- 직장/조장
  'WORKER',           -- 작업자
  'OWNER_PM',         -- 발주처 PM
  'OWNER_HSE',        -- 발주처 안전
  'SUPERVISOR'        -- 감리
);
```

### 테이블 변경

```sql
-- user_roles: master 전용으로 정리
-- (기존 데이터는 마이그레이션으로 project_members로 이관)
-- enum 타입을 global_role로 교체

-- project_members
ALTER TABLE project_members
  ADD COLUMN role_new project_role,
  ADD COLUMN position_new project_position,
  DROP COLUMN company;               -- TEXT 중복 제거 (SSOT)
-- role_new로 데이터 이관 후 role 컬럼 교체

-- profiles
ALTER TABLE profiles
  DROP COLUMN company,               -- 프로젝트별 다를 수 있으므로 project_members로 이전
  DROP COLUMN position;              -- 동일

-- companies (변경 없음 - type 컬럼은 그대로 사용)
```

### 보조 함수 (모두 SECURITY DEFINER, search_path=public)

```sql
-- 글로벌 역할 체크 (master 전용)
is_master(_user_id uuid) RETURNS boolean

-- 프로젝트 역할 조회
get_project_role(_user_id uuid, _project_id uuid) RETURNS project_role

-- 프로젝트 권한 체크
has_project_role(_user_id uuid, _project_id uuid, _roles project_role[]) RETURNS boolean

-- 회사 격리: 사용자가 해당 회사 데이터를 볼 수 있는가
can_access_company_data(_user_id uuid, _project_id uuid, _company_id uuid) RETURNS boolean
  -- master/project_admin/safety_manager: 모든 회사
  -- 그 외: 본인 company_id 또는 하위 회사(parent_company_id 트리)

-- 직책 기반 결재선 매칭
get_user_position(_user_id uuid, _project_id uuid) RETURNS project_position
```

---

## 3. 권한 매트릭스 (역할 × 기능)

| 기능 | master | project_admin | safety_manager | site_manager | supervisor | worker | viewer |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 프로젝트 생성/삭제 | ✓ | – | – | – | – | – | – |
| 멤버 초대/제거 | ✓ | ✓ | – | – | – | – | – |
| 회사(협력사) 관리 | ✓ | ✓ | – | – | – | – | – |
| 위험성평가 작성 | ✓ | ✓ | ✓ | ✓ | – | 자기회사 | – |
| 위험성평가 승인 | ✓ | ✓ | ✓ | ✓(설정) | – | – | – |
| 작업계획서 작성 | ✓ | ✓ | ✓ | ✓ | – | 자기회사 | – |
| 작업허가서 승인 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| 안전점검 등록 | ✓ | ✓ | ✓ | ✓ | ✓ | – | – |
| TBM 운영 | ✓ | ✓ | ✓ | ✓ | – | 참여만 | – |
| 산업안전보건관리비 | ✓ | ✓ | ✓ | – | – | – | – |
| 법적업무 | ✓ | ✓ | ✓ | – | – | – | – |
| 사고 신고(모바일) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| 감사 로그 조회 | ✓ | ✓ | – | – | – | – | – |
| 기준정보 관리 | ✓ | ✓ | – | – | – | – | – |
| 모든 데이터 읽기 | ✓ | ✓ | ✓ | 자기회사+하위 | 자기회사 | 자기회사 | 자기회사 |

**회사 격리 규칙** (RLS에 강제):
- `master`/`project_admin`/`safety_manager` → 프로젝트 내 전 회사 접근
- `site_manager`/`supervisor` → 본인 회사 + parent_company_id 트리의 하위 회사
- `worker`/`viewer` → 본인 `company_id` 데이터만

---

## 4. 마이그레이션 단계

### Phase 1 — DB 스키마 (1 마이그레이션)
1. `global_role`, `project_role`, `project_position` enum 생성
2. `is_master`, `has_project_role`, `can_access_company_data`, `get_user_position` 함수 생성
3. `project_members.role_new project_role`, `position_new project_position` 추가
4. `project_members.company TEXT` 삭제
5. `profiles.company`, `profiles.position` 삭제

### Phase 2 — 데이터 이관 (insert 도구로)
1. `user_roles`에서 비-master 행(`safety_manager`, `project_admin`)을 모든 기존 프로젝트의 `project_members.role_new`로 이관
   - master는 그대로 유지
2. `project_members.role` → `role_new` 복사 (이름 매핑)
3. `project_members.company_id` 채우기:
   - `project_members.company` TEXT 값으로 `companies.name` 매칭 → `company_id` 채움
   - 매칭 실패 항목은 콘솔 출력 후 마스터가 수동 보정

### Phase 3 — 컬럼 교체 마이그레이션
1. `project_members.role` DROP, `role_new` → `role` RENAME
2. `position` 컬럼 동일
3. `app_role` enum DROP (이제 사용 안 함)

### Phase 4 — RLS 정책 재작성
1. `companies` 정책에서 **인수 순서 버그 수정** + `safety_manager` 권한 추가
2. 모든 비즈니스 테이블(work_plans, work_permits, tbm_sessions, safety_costs, …) RLS를 `can_access_company_data()` 기준으로 통일
3. `user_roles` 정책: master만 INSERT/UPDATE/DELETE

### Phase 5 — 코드 보완
1. `useProjectAccess` hook을 새 enum/함수에 맞춰 갱신
   - `userRole: ProjectRole` 타입을 새 enum과 1:1 매칭
   - `PERMISSION_MATRIX` 위 표대로 재작성
2. `AuthContext`: `profile.company`/`profile.position` 제거, 대신 선택된 프로젝트의 `project_members`에서 조회
3. `useGlobalProjectAccess` (AppLayout)에 `position`, `companyType` 추가
4. 결재선 매칭(`approval_lines`)을 `project_position` enum 키 기반으로 변경
5. UserManagement / 초대 코드 UI에 position/role 드롭다운(enum) 추가

### Phase 6 — 감사·복구
1. 마이그레이션 전 백업 쿼리 결과를 audit_logs에 1회 기록
2. 마스터 페이지에 "권한 데이터 이관 결과" 카드 추가 (누가 어느 회사/직책으로 이관됐는지 표)

---

## 5. 위험 / 롤백

| 위험 | 완화 |
|------|------|
| 데이터 이관 중 RLS 권한이 일시적으로 끊겨 사용자 로그인 후 빈 화면 | enum/함수/컬럼 추가는 비파괴(ALTER ADD)로 먼저 적용 → 코드와 데이터 이관 완료 후에야 옛 컬럼 DROP |
| 협력업체 매칭 실패 (company TEXT ↔ companies.name 불일치) | Phase 2에서 실패 목록을 별도 테이블 `migration_unmapped_members`에 적재 → 마스터 UI에서 수동 매핑 |
| 결재선 깨짐 | Phase 5에서 기존 `approval_lines.position`(TEXT)을 새 enum으로 자동 보정하는 매핑표 + 미매칭은 master 알림 |

---

## 6. 검증 체크리스트
- [ ] `companies` 정책 인수 순서 버그 수정 후 project_admin이 새 회사를 생성/수정 가능
- [ ] worker로 로그인 시 본인 회사 외 work_plans/risk_items 조회 시 빈 결과
- [ ] safety_manager는 모든 회사 데이터 조회 가능
- [ ] master 1명 미만 방지 트리거 정상 (기존 유지)
- [ ] 초대 코드(`process_invite_code`)가 새 project_role enum과 동작
- [ ] 결재선 매칭이 position enum 기준으로 100% 매핑

---

## 7. 영향 받는 파일 (예상)

**DB**: 마이그레이션 4~5건 + insert 1건
**코드**:
- `src/hooks/useProjectAccess.ts` (대규모)
- `src/contexts/AuthContext.tsx` (profile 타입)
- `src/components/AppLayout.tsx` (`useGlobalProjectAccess`)
- `src/components/ApprovalLineManager.tsx`
- `src/components/DepartmentAssigneeMapping.tsx`
- `src/pages/UserManagement.tsx`
- `src/pages/SettingsPermissions.tsx`
- `src/pages/Profile.tsx`
- `src/integrations/supabase/types.ts` (자동 생성)

총 6 phase, 추정 3~4 라운드 소요.

---

## 8. 확인 필요 (사용자 결정)

1. **`project_role` enum의 6개 값**(project_admin / safety_manager / site_manager / supervisor / worker / viewer)이 우리 회사 현장과 맞는가? 추가/삭제 필요?
2. **회사 위계 격리**: site_manager가 "본인 회사 + 하위 협력업체"를 보는 규칙이 맞는가, 아니면 본인 회사만?
3. **데이터 이관 중 다운타임 허용 시간**: 기존 사용자 영향 없이 단계적으로 갈지(권장), 한번에 갈지?
4. **기존 `app_role` enum의 `user`/`contractor` 값** 처리: drop해도 되는지(현 데이터에 사용 흔적 0건)?

이 4개 답변 주시면 바로 Phase 1 마이그레이션부터 실행합니다.
