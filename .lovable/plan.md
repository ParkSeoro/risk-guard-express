# 시스템 테스트 엔진 (System QA Engine)

기존 AI 테스트 엔진(`/admin/ai-test`)과는 별개로, **시스템 전체 동작/권한/연동/무결성**을 검증하는 독립 모듈을 추가합니다. 마스터 전용. 기존 기능은 일절 변경하지 않습니다.

## 1. 아키텍처

```text
[Master UI]  ──►  /admin/system-test
   │
   ▼
src/lib/systemTest/
   ├─ runner.ts           시나리오 실행 엔진 (PASS/FAIL/점수 집계)
   ├─ context.ts          테스트 컨텍스트 (격리된 임시 데이터, 자동 정리)
   ├─ scenarios/
   │    ├─ admin.ts          프로젝트/사용자/평가/계획/허가
   │    ├─ contractor.ts     시공사/협력사 평가·계획·TBM
   │    ├─ worker.ts         QR 참여 / 서명 / 입퇴장
   │    ├─ permissions.ts    역할별 접근 PASS/FAIL
   │    ├─ workflow.ts       RA→WP→Permit→TBM→점검→사고→비용 연동
   │    ├─ notifications.ts  알림 발생 검증
   │    └─ integrity.ts      저장/수정/중복 검사
   └─ report.ts           기능별 점수, 오류 위치 리포트
```

- 운영 시스템과 분리: 모든 테스트 데이터는 `__qa__` prefix + `qa_run_id` 태깅 → 종료 시 일괄 soft-delete
- 제3자 관점: 직접 supabase-js / edge function curl 호출, UI 컴포넌트 의존성 없음
- 권한 테스트는 **테스트용 임시 사용자 토큰**(아래 DB 함수)으로 별도 클라이언트를 만들어 호출

## 2. DB 마이그레이션

신규 테이블 (RLS: master only):
- `system_test_runs` — id, started_by, started_at, finished_at, total_score, status (running/completed/failed)
- `system_test_results` — run_id, scenario_key, step_key, pass_fail, duration_ms, error_location, details(jsonb), score
- `system_test_artifacts` — run_id, kind, ref_table, ref_id (정리 추적용)

신규 RPC (SECURITY DEFINER, master only):
- `qa_cleanup_run(run_id uuid)` — 해당 run의 artifacts 전부 soft-delete
- `qa_impersonate_check(_role app_role, _project_id uuid)` — 권한 시뮬레이션 결과 반환 (실제 토큰 발급 없이 RLS 함수들 호출)

> 권한 시나리오는 새 사용자를 만들지 않고 `has_role`, `is_project_member`, `can_access_safety_cost`, `get_project_role` 등 기존 함수를 마스터 권한으로 호출해 EXPECT vs ACTUAL 비교.

## 3. 시나리오 (요약)

| 키 | 단계 | 검증 |
|---|---|---|
| admin.create_project | 프로젝트 INSERT | row 존재 + RLS |
| admin.approve_user | profile.account_status='active' | 변경 반영 |
| admin.create_ra | assessment_runs INSERT + items | 연결 무결성 |
| admin.create_wp | work_plans INSERT | RA 참조 |
| admin.approve_permit | work_permits 상태 전이 | 알림 트리거 |
| contractor.write_ra | 협력사 컨텍스트로 RA | company_id 격리 |
| contractor.tbm | tbm_sessions 생성 | qr_token 발급 |
| worker.qr_join | get_tbm_by_token | session 매칭 |
| worker.sign_in | submit_tbm_participation + worker_entry | 서명 길이/중복 |
| perm.master_all | 모든 리소스 접근 | true |
| perm.contractor_isolated | 타 회사 데이터 접근 | false |
| flow.ra_to_cost | RA→WP→Permit→TBM→Inspection→Incident→SafetyCost 체인 | 각 단계 ID 연결 |
| notify.fail | 강제 FAIL → 알림 row | notifications 테이블 신규 row |
| notify.approve | 승인 → 알림 row | 동일 |
| integ.crud | INSERT/UPDATE/SELECT 일치 | 값 비교 |
| integ.dup | 동일 데이터 2회 시도 | 거부 또는 단일 row |

각 step → `{pass, duration, error_location?, details}` 반환. 시나리오별 점수 = pass비율 × 100. 총점 = 가중 평균.

## 4. UI: `src/pages/SystemTestEngine.tsx`

- 라우트: `/admin/system-test` (App.tsx에 master gate)
- 사이드바 "시스템" 그룹 + masterOnlyItems에 추가 (아이콘: `FlaskConical`)
- 구성:
  - 상단: "전체 실행" / 시나리오별 실행 버튼 그리드
  - 진행률 Progress bar + 현재 step 라벨
  - 결과 트리: 시나리오 → step, PASS/FAIL 배지, 오류 위치, duration
  - 기능별 점수 카드 (관리자/시공사/근로자/권한/연동/알림/무결성)
  - 최근 실행 이력 (system_test_runs)
  - "테스트 데이터 정리" 버튼 (qa_cleanup_run)

## 5. 기존 시스템 영향

- 기존 코드 수정: `App.tsx`(라우트 1줄), `AppSidebar.tsx`(masterOnlyItems 1줄) **만**
- 모든 시나리오는 try/finally로 자동 정리. 실패해도 운영 데이터 오염 없음
- 알림 테스트는 dev `EMAIL_OVERRIDE`로 외부 발송 차단됨

## 완료 기준 매핑

- ✅ 전체 자동 테스트: `runAll()` 한 버튼
- ✅ 권한 검증: permissions 시나리오 + perm.* 키
- ✅ 기능 연동: flow.ra_to_cost
- ✅ 결과 리포트: system_test_results + UI 점수/오류위치 + CSV 내보내기
