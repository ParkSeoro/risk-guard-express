## 문제 진단

### 1) 멤버 추가 다이얼로그 오류 원인
`ProjectDetail.tsx` 멤버 추가 유효성 검사는 `site_manager / supervisor / worker` 역할 선택 시 소속 업체가 필수인데, **다이얼로그 UI는 `contractor` 역할일 때만 업체 선택 셀렉트를 렌더**합니다. 그래서 "관리감독자"를 고른 순간 업체 필드가 나타나지 않고 저장을 누르면 빨간 토스트가 뜹니다. (`src/pages/ProjectDetail.tsx` L1052)

### 2) 신규 사용자 온보딩이 복잡한 이유
현재 흐름:
- 회원가입 시 프로젝트/업체/직종을 이미 선택 → `process_signup_company_selection` RPC가 **project_members에 이미 삽입**함.
- 그러나 계정은 `pending` 상태이고, 마스터가 승인 후에도 UI상에서는 별도 "멤버 추가"·"업체 등록"을 다시 해야 하는 것처럼 보임.
- 원인:
  a. 승인 화면에 "가입 시 선택한 프로젝트/업체/직종" 요약이 표시되지 않아 이미 연결되어 있다는 사실이 숨겨짐.
  b. 가입 시 프로젝트에 원하는 업체가 없으면 가입 자체가 불가능(수동 등록 필요) → 마스터가 사전에 회사관리+프로젝트 링크를 해두어야 함.
  c. 관리자(예: 안전관리자) 지정을 위한 role 승격이 별도 화면에서 이뤄져야 함.

---

## 개선 계획

### A. 멤버 추가 다이얼로그 UX 정리 (버그 수정)
`src/pages/ProjectDetail.tsx`
- 업체 선택 필드를 `contractor` 뿐 아니라 `site_manager / supervisor / worker / safety_manager` 등 **업체 소속이 의미 있는 모든 역할에서 노출**. 실무상 대부분 필요하므로 기본은 "항상 표시(선택 사항)"로 전환하고, 검증 규칙과 동일한 역할만 필수(*) 표시.
- 사용자 선택 시 해당 사용자의 프로필 company 를 기본값으로 자동 채움 → 대부분 클릭 한 번으로 완료.
- 추가 실패 토스트에 어떤 필드가 비었는지 명시.

### B. 원클릭 승인 = 자동 온보딩
`src/pages/UserManagement.tsx` (승인 화면)
- pending 사용자 카드에 **가입 시 선택한 프로젝트 / 업체 / 직종**을 배지로 노출.
- "승인" 버튼 하나로:
  1. `profiles.account_status = 'active'`
  2. `project_members` 에 이미 존재하는 행 확인/보정 (position, company)
  3. 기본 `role_new`를 가입 시 선택한 직종에 따라 자동 매핑
     - `site_manager / safety_manager` → `safety_manager` 권한
     - `supervisor / foreman` → `user`
     - `worker` → `user` (열람 위주)
  4. 승인 시 관리자가 원하면 드롭다운으로 즉시 권한 격상(예: 프로젝트 관리자) 선택 가능.
- 신규 SECURITY DEFINER RPC `approve_pending_user(_user_id, _override_role?)` 로 위 처리를 트랜잭션화하고 audit log 남김.

### C. 회사관리 수동 등록 제거 — 셀프서비스 업체 요청
가입 화면(`Auth.tsx`)에서 원하는 업체가 목록에 없을 때 **"내 업체 신규 요청"** 옵션 추가:
- 사용자가 회사명·사업자번호·전화 입력 → 새 RPC `request_new_company_at_signup` 이 `companies` 는 만들지 않고 `project_join_requests`(또는 신규 경량 테이블 `company_join_requests`) 에 요청만 저장.
- 마스터의 승인 화면에서 "회사 신규 요청" 배지가 표시되며 **승인 클릭 시**:
  1. `companies` upsert (normalized 이름으로 중복 방지)
  2. `project_companies` 링크 자동 생성 (필요 시 상위 시공사 지정 UI 노출)
  3. B단계의 `project_members` 자동 연결까지 함께 수행
- 결과: 마스터가 별도로 "회사관리"에 들어가 등록할 필요 없음. 승인 한 번이 곧 회사 등록 + 프로젝트 등록 + 멤버 추가.

### D. 승인 화면 UX 강화
`UserManagement.tsx` 또는 신규 `PendingApprovals` 섹션
- KPI: 신규 사용자, 신규 업체 요청, 총 대기.
- 각 카드에 가입 시 정보 요약, "일괄 승인" 다중 선택.
- 반려 시 사유 필수(기존 audit 패턴 유지).

### E. 알림 & 감사
- 승인/반려 시 신청자에게 인앱 알림 및 이메일(기존 Resend 파이프라인 재활용).
- 모든 액션 `audit_logs` 기록 (`가입승인`, `회사요청승인`, `멤버자동연결`).

---

## 기술 세부사항 (기술자용)

**DB 마이그레이션**
- `create table public.company_join_requests` (id, requester_user_id, project_id, requested_name, business_no, phone, parent_company_id nullable, status, note, created_at) + RLS + GRANT + service_role. 마스터만 SELECT/UPDATE, 요청자는 본인 것 SELECT/INSERT.
- 함수:
  - `approve_pending_user(_user_id uuid, _override_role project_role default null)` — profiles active, project_members backfill/upsert, role 매핑, audit.
  - `approve_company_request(_request_id uuid, _parent_company_id uuid default null)` — companies upsert (normalized), project_companies insert, request status='approved', audit.
  - `request_new_company_at_signup(_project_id, _name, _business_no, _phone)` — anon 호출 가능(SECURITY DEFINER), rate limit(같은 이메일/IP 5분 1회).
- 기존 `process_signup_company_selection` 은 유지하되, 업체 미선택+요청 병행 케이스 처리 분기 추가.

**프런트엔드 변경 파일**
- `src/pages/Auth.tsx` — 업체 목록 하단 "내 업체가 없어요 → 새 업체 요청" 링크 및 폼.
- `src/pages/UserManagement.tsx` — 승인 카드 요약, 원클릭 승인, 회사 요청 탭.
- `src/pages/ProjectDetail.tsx` — 멤버 추가 다이얼로그 업체 필드 상시 노출, 자동 기본값.
- 신규 컴포넌트 `PendingCompanyRequests.tsx` (SettingsCompanies 상단 배너 + 상세).

**롤아웃 순서**
1. A(버그 수정) — 즉시 반영.
2. B(원클릭 승인) — 마이그레이션 + UM 개편.
3. C+D(셀프 업체 요청) — 마이그레이션 + Auth/UM UI.
4. E(알림) — Resend 템플릿 추가.

---

## 산출물
- 마이그레이션 3건, 신규 RPC 3건.
- 수정 파일 3개, 신규 컴포넌트 1개.
- 승인 1클릭 = 회사 등록 + 프로젝트 링크 + 멤버 자동 배정 완료.
