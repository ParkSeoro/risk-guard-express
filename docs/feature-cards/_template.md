# Feature Card — {기능 이름}

> 한 기능이 "완료"되었다고 선언하려면 아래 8개 항목이 **모두** 체크되어야 합니다.
> 체크되지 않은 항목은 "남은 작업" 섹션에 옮기세요. PR 머지 전에 리뷰어가 이 카드를 검토합니다.

- 담당자:
- 관련 라우트:
- 관련 테이블:
- 관련 RPC:
- 관련 시나리오 키 (`src/lib/systemTest/scenarios.ts`):

---

## 1. Happy path
- [ ] 정상 입력으로 결과가 화면에 표시된다
- [ ] 생성/조회/수정/삭제 4개 액션이 모두 동작한다
- 시나리오 키:

## 2. Permission (역할 × CRUD)
- [ ] master / project_admin / safety_manager / site_manager / supervisor / worker / viewer 7역할 매트릭스 통과
- [ ] `useProjectAccess.can*` 호출만 사용 (인라인 `role === ...` 분기 없음)
- 매트릭스 테스트: `src/test/permissions.matrix.test.ts`

## 3. Scope (회사/프로젝트 격리)
- [ ] 다른 프로젝트의 행이 SELECT 로 보이지 않음
- [ ] 다른 회사의 INSERT/UPDATE/DELETE 가 RLS 로 차단됨
- [ ] 시공사(worker) 역할은 자기 회사 데이터만 보임

## 4. Empty / Loading / Error UI
- [ ] 데이터 0건 UI (안내 문구 + CTA)
- [ ] 로딩 중 스켈레톤/스피너
- [ ] 네트워크 실패 시 `useToastError` 로 사용자에게 표시 (silent fail 금지)

## 5. Edge inputs
- [ ] `IMESafeInput` / `IMESafeTextarea` 사용 (한글 IME)
- [ ] 긴 텍스트 (2,000자) 잘림 없이 저장/표시
- [ ] 0/음수/공백 입력 zod 검증
- [ ] 첨부 0개·다중·대용량(10MB) 모두 처리

## 6. State sync (결재·미러·알림)
- [ ] 결재완료 시 도큐먼트 status 가 같은 트랜잭션에서 갱신됨
- [ ] 관련자에게 알림(인앱 + 푸시 + 이메일) 발송
- [ ] 사이드바 뱃지/카운트가 즉시 갱신됨

## 7. Audit
- [ ] CRUD 가 `audit_logs` 에 기록됨
- [ ] 변경 사유(reason) 필수 액션은 사유 없이 저장 차단

## 8. Rollback
- [ ] 삭제는 `useSoftDelete` 경유 (휴지통 복원 가능)
- [ ] 결재 취소/반려/재상신 경로 존재
- [ ] 잘못된 OTA/배포 1클릭 롤백 (해당 시)

---

## 회귀 테스트 링크
- vitest: `src/test/{기능}.test.ts`
- E2E (`/admin/system-test`): `SCENARIOS.{key}`

## 남은 작업
-
