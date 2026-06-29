# Feature Card #25 — 출입 QR & 입퇴장 (Worker Access)

## Pages
- `src/pages/CompanyDailyQR.tsx` — 시공사 일일 게시판 QR 발급/인쇄
- `src/pages/CompanyScan.tsx` — 근로자 스캔 → 본인 입력 → 출입 기록 생성
- `src/pages/WorkerAttendance.tsx` — 입퇴장 현황 모니터링

## 8-Dim Polish

1. **KPI Cards** — 전체/발급/미발급 (QR), 입장중/퇴장/확인미완/무재해 (Attendance)
2. **Search & Filter** — 시공사명·유형 검색, 발급상태 탭(전체/발급/미발급); 입퇴장은 회사·상태 필터 + 검색
3. **Skeleton Loading** — 카드 그리드/테이블 로딩 상태 분리
4. **Empty States** — "등록된 시공사 없음" vs "필터 결과 없음" 구분
5. **Realtime** — `company_daily_qr`(공통), `worker_entry_logs`(프로젝트별) 실시간 구독
6. **Inline Actions** — 미발급 카드에 즉시 [발급] 버튼, 전체 일괄 발급
7. **Permission Scope** — RLS 위임(시공사는 본인 회사 QR만 발급/조회)
8. **Print Optimized** — `print:hidden` / `print:grid-cols-2` / `break-inside-avoid`로 인쇄 레이아웃 분리

## Legal
- 산안법 §62 작업장 출입관리, §29 교육이수 확인 — 입퇴장 시 위험성평가/교육/TBM 확인 배지
