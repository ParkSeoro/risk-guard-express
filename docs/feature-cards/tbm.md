# Feature Card — TBM (Tool Box Meeting / QR 작업 전 안전회의)

- 담당자: -
- 관련 라우트: `/tbm-logs`, `/m/tbm`, `/m/tbm/:token` (참여 페이지), `/admin/trash`
- 관련 테이블: `tbm_sessions`, `tbm_participations`, `companies`, `assessment_runs(run_id)`
- 관련 RPC: `submit_approval` (TBM 결재 시), `compute_worker_required_education`
- 관련 시나리오 키: `tbm_create_qr_participate`

---

## 1. Happy path
- [x] 관리자가 TBM 세션을 생성하고 QR을 인쇄한다
- [x] 근로자가 QR 스캔 → 이름·전화번호 입력 + 서명 → `tbm_participations` 1행 생성
- [x] "일지 인쇄" 로 KOSHA 표준 A4 PDF 출력 (참여자/서명 포함)
- 시나리오 키: `tbm_create_qr_participate`

## 2. Permission (역할 × CRUD)
- [x] master / project_admin / safety_manager: 모든 TBM CRUD + QR 재발급
- [x] site_manager / supervisor: 자기 회사 TBM CRUD
- [x] worker: 참여만 (QR 스캔 → tbm_participations insert)
- [x] viewer: 조회만
- [x] `useProjectAccess.canEditTbm` / `canDeleteTbm` 으로 일원화 (인라인 role 체크 없음)
- 매트릭스 테스트: `src/test/permissions.matrix.test.ts` (`feature: 'tbm'`)

## 3. Scope (회사/프로젝트 격리)
- [x] `tbm_sessions.project_id` RLS — 다른 프로젝트 TBM SELECT 차단
- [x] worker 역할은 자기 회사 (`company_id`) TBM 참여만 허용
- [x] 참여자(`tbm_participations`) 는 본인 행만 SELECT (전화번호 PII 보호)

## 4. Empty / Loading / Error UI
- [x] 0건 상태: 아이콘 + "첫 TBM 생성" CTA (`TbmManager.tsx`)
- [x] 로딩 중 스켈레톤 (3행 muted bar)
- [x] QR 생성 실패 시 `toast({ variant: 'destructive' })` (silent fail 없음)
- [x] 미리보기 도메인에서 QR 발급 시 게시 도메인으로 자동 폴백 + 안내 문구

## 5. Edge inputs
- [x] 제목/장소/공종 등은 짧은 입력 → 일반 `Input` 사용. 본문(작업내용/순서/금지사항)은 `Textarea` 다중행
- [x] 위험요인 0건일 때 "추가" CTA 노출, 자동 불러올 risk 없을 때도 빈 상태 안내
- [x] 첨부 (사진/도면) 은 별도 `evidence_attachments` 모듈로 위임
- [x] 회사 미선택 시 저장 차단 (toast)

## 6. State sync (결재·미러·알림)
- [x] 참여자 카운트 뱃지 즉시 갱신 (`participantCounts` map, load 시 일괄 조회)
- [x] QR 토큰은 `is_active=false` 일 때 참여 페이지에서 거절
- [x] 결재 제출 시 `submit_approval` 으로 통합 결재함에 노출 (사이드바 뱃지 자동)

## 7. Audit
- [x] 삭제 시 `useSoftDelete` → `audit_logs.soft_delete` + 사유 필수
- [x] QR 재발급은 `qr_token` 컬럼 변경 → DB 트리거 `audit_logs` 기록
- [x] 활성/종료 토글은 `audit_logs.tbm_toggle_active` 로 기록

## 8. Rollback
- [x] 삭제는 `useSoftDelete('tbm_sessions', …)` 사용 — `/admin/trash` 에서 30일 내 복원 가능
- [x] 잘못 발급한 QR 은 "QR 자동재생성" 버튼으로 즉시 무효화 + 재발급
- [x] 참여 서명 잘못 입력 시 master 가 `tbm_participations` 행 단건 삭제 가능

---

## 회귀 테스트 링크
- vitest: 권한 매트릭스 `src/test/permissions.matrix.test.ts` (`tbm` feature)
- E2E (`/admin/system-test`): `SCENARIOS.tbm_create_qr_participate`

## 남은 작업
- (선택) TBM 미참여 근로자 알림 자동화 — 출근 QR 스캔 후 1시간 내 TBM 미참여 시 안전관리자에게 푸시
- (선택) 모바일 `/m/tbm` 에서 오늘의 활성 TBM 자동 정렬 + "내 회사" 필터 디폴트 ON
