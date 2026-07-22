## 1) 사용자 3인 소속/이메일 정정

현재 DB 확인 결과:

- 박서로: 소속 `에어리퀴드 코리아` (이미 반영, 표기만 `에어리퀴드코리아`로 통일)
- 정재선, 박종훈: 소속 `디아이지에어가스` → `에어리퀴드코리아`로 변경
- 세 명 모두 이메일 도메인 `@dig-airgas.com` → `@airliquide.com`

작업

- `profiles.company`를 3인 모두 `에어리퀴드코리아`로 UPDATE
- 필요 시 `company_id`를 기존 `에어리퀴드`(companies 테이블) 레코드로 매핑
- `auth.users.email`을 `local-part@airliquide.com`으로 UPDATE (Admin API 또는 마이그레이션 SQL로 관리자 권한 변경)
- 로그인 이메일 변경 사실을 본인에게 안내(별도 알림 없이 완료 토스트만)

## 2) "결재함" → "전자결재" 리네이밍 (UI만)

교체 대상(라벨/문자열):

- `src/components/AppSidebar.tsx` (사이드바 메뉴)
- `src/pages/Approvals.tsx` (헤더 h1)
- `src/pages/MobileApprovals.tsx` (헤더/주석)
- `src/pages/MobileHome.tsx` (카드 라벨)
- `src/pages/PermissionTest.tsx`
- `src/pages/ConsistencyAudit.tsx`
- `src/lib/mobileMenuPrefs.ts`
- `src/lib/helpDictionary.ts`
- `src/lib/systemTest/mobileScenarios.ts`

라우트/코드 심볼(`/approvals`, `MobileApprovals` 등)은 그대로 유지 — 표시 문자열만 변경.

## 3) 전자결재 규칙 SSOT 정립

현재 상태 요약(파악 결과)

- 규칙 자체는 이미 상당 부분 공용화되어 있음: 모든 모듈이 `SubmitApprovalDialog` + `approval_route_templates` + RPC(`submit_approval`, `act_on_approval`, `get_eligible_approvers`, `get_my_pending_entity_approvals`)를 공유.
- 다만 다음 3가지가 흩어져 있어 “규칙이 모듈마다 다르다”는 인상이 남음:
  1. **기본 결재선(default steps)** 이 `SubmitApprovalDialog` 내부에 하드코딩 (작업허가서만 5단계, 나머지는 `검토` 1단계).
  2. **엔티티 라벨/아이콘** 이 `ENTITY_LABELS`에만 있고, 각 모듈에서 별도 문구를 다시 씀.
  3. **결재선 템플릿 관리(SettingsApprovalRoutes)** 는 있지만, "전자결재 모듈에서 전체 규칙(엔티티 목록/기본 단계/역할 라벨/재상신·위임 정책)을 한 곳에서 볼 수 있는 허브 화면"이 없음.

리팩토링 계획

- **신규 SSOT 파일: `src/lib/approvalRules.ts**`
  - `ENTITY_LABELS`, `POSITION_LABELS`, `DEFAULT_STEPS_BY_ENTITY`(작업허가서 5단계 포함 전 엔티티), `RESUBMIT_POLICY`(사유 필수 여부), `DELEGATE_POLICY`를 단일 export.
  - `SubmitApprovalDialog`, `SettingsApprovalRoutes`, `MobileApprovals`, `Approvals`, `WorkPermitDetail` 등이 모두 이 파일만 참조하도록 수정.
  - `SubmitApprovalDialog` 내부 하드코딩(작업허가서 5단계 등) 제거 → `DEFAULT_STEPS_BY_ENTITY[entityType]` 사용.
- **전자결재 허브 화면 강화: `/approvals` (기존 Approvals.tsx)**
  - 상단에 탭 2개: `결재 대기함` / `규칙(전자결재 정책)`.
  - “규칙” 탭에 다음을 노출/편집(Master/PA만 편집):
    - 엔티티별 기본 결재선(위 SSOT 값, project 단위 override 가능 → `approval_route_templates`의 project-default 로 저장)
    - 재상신 시 사유 필수 여부, 최종 승인자 알림 정책, 위임 허용 여부(existing `delegate_approval` RPC와 연동)
    - `SettingsApprovalRoutes` 로 이동하는 링크 유지
- **각 모듈 정리**
  - 작업허가서/작업계획서/위험성평가/안전보건관리비/사고/훈련/TBM 모두 “기본 결재선/사유/알림/위임”을 자체 로직으로 재정의하지 않도록 확인, 발견 시 SSOT 호출로 치환.

## 확인 필요 (1가지만)

`에어리퀴드코리아` 명칭 통일 시, `companies` 테이블의 기존 `에어리퀴드` 레코드 이름도 `에어리퀴드코리아`로 변경할까요, 아니면 `profiles.company` 텍스트만 `에어리퀴드코리아`로 갱신하고 회사 매핑은 그대로 둘까요? (동일 이름 회사 레코드가 2건 존재)

`companies` 테이블의 기존 `에어리퀴드` 레코드 이름도 `에어리퀴드코리아`로 변경

## 기술 세부

- 이메일 변경은 `auth.admin.updateUserById`를 서버(Edge Function `admin-update-email`)를 통해 수행하거나, 임시로 마이그레이션 내 `UPDATE auth.users SET email = ...`(관리자 SQL) 사용. 후자를 우선 채택.
- `profiles` 갱신은 `supabase--insert` 툴로 UPDATE 실행.
- 리브랜드는 문자열 치환 위주라 로직/타입 영향 없음.
- SSOT 리팩토링은 신규 파일 1개, 기존 파일 ~6개 수정.