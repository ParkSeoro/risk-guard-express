# Feature Card — 근로자 관리 (#7)

- 관련 라우트: `/workers`, `/worker/register` (레거시 `/c/:token`, `/worker-portal` 유지·비권장)
- 관련 테이블: `workers`, `worker_attendance`, `worker_entry_logs`
- 관련 컴포넌트: `WorkerManagement.tsx`, `WorkerBulkImportDialog.tsx`
- 사이드바: **근로자 관리** 1항목 → 페이지 탭(등록 정보 / 입퇴장 현황)

---

## 1. Happy path
- [x] 2개 탭(등록정보 / 입퇴장)이 URL 쿼리(`?tab=`)와 동기화
- [x] 등록 QR / 엑셀 일괄등록 / 법정교육 매핑 진입
- [x] 레거시 일일·게시판 QR 탭 URL은 등록 탭으로 리다이렉트 (앱 출근으로 대체)
- [x] 출퇴근은 근로자 앱 계정·GPS 출근이 SSOT

## 2. Permission
- [x] 협력사 권한(`site_manager`/`supervisor`/`worker`)은 본인 소속사로 자동 잠금
- [x] 마스터·관리자는 전체 회사 선택 가능
- [x] QR 발급은 `useProjectAccess` 통과 사용자만, 게시판 스캔(/c/:token)은 익명 토큰 인증

## 3. Scope
- [x] `workers.is_active = true` + `project_id` 필터로 활성 근로자만 노출
- [x] 회사·프로젝트 RLS 격리 (`worker_entry_logs_no_insert_policy` 보안 픽스 적용)
- [x] QR 토큰은 회사+날짜+만료시각으로 1일 단위 격리

## 4. Empty / Loading / Error UI
- [x] 데이터 로딩 중 스켈레톤 5행
- [x] 등록 0건: 아이콘 + 등록 QR / 엑셀 등록 CTA 동시 노출
- [x] 검색 결과 0건: "전체 보기" 링크 즉시 복귀
- [x] QR 미발급 시 자리 표시자 + "일괄 발급" 버튼

## 5. Edge inputs
- [x] 검색 필터(이름·전화·소속사·직종) 클라이언트 측 즉시 반영
- [x] 비활성 처리 시 사유 prompt 필수, 빈 사유는 에러 토스트
- [x] 스캔 시 이름+연락처(8자 이상)+서명+체크박스 모두 충족해야 제출
- [x] 오프라인이면 자동으로 `offlineQueue` 에 적재 후 네트워크 복귀 시 자동 전송

## 6. State sync
- [x] 사이드바에서 다른 탭으로 이동 시 `tabParam` 변경 → `useEffect` 로 즉시 전환
- [x] 비활성 처리 후 목록에서 즉시 제거(로컬 상태)
- [x] 탭 라벨에 등록 인원 카운트 뱃지 노출

## 7. Audit
- [x] 비활성 처리는 `audit_logs.action=soft_delete` + 사유 기록
- [x] QR 스캔 출퇴근은 `idempotency_key` 로 중복 방지 & 감사 기록
- [x] 일괄 발급은 성공/실패 카운트와 마지막 에러 메시지 토스트

## 8. Rollback
- [x] 비활성 처리한 근로자는 상세 화면에서 재활성 가능(`is_active=true`)
- [x] QR 만료 시 익일 0시 자동 만료 → 재발급으로 회복
- [x] 오프라인 큐는 idempotency 보장으로 중복 입력 없음

---

## 남은 작업
- (선택) 비활성 근로자만 별도로 보는 필터 토글
- (선택) 등록 정보 CSV 내보내기
