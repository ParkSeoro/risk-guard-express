## 답변 + 수정 계획

### 1) 지금까지의 변경 요약 (질문 답)
- 권한: `useProjectAccess` + `PERMISSION_MATRIX`로 **역할(role) × 기능(feature)** 별 권한이 일원화돼 있고, RLS가 **프로젝트/회사** 격리를, `applyCompanyFilter`가 클라이언트 보조 필터를 담당합니다. 결재라인/담당자 매핑은 회사(소속) 단위 필터가 적용되어 있습니다 → "사용자별·회사별·소속별" 권한 작동 중.
- 안정성: 오늘 사이클(#1~#29) 동안 Realtime/Skeleton/D-Day/검색·탭 표준화, 감사·소프트삭제 보강, 결재 SSOT 일치, 보안 7건 픽스 완료. 다만 **남아있는 런타임 이슈가 1건 확인됨 → 인쇄/PDF**.

### 2) 위험성평가 인쇄·PDF 원인
`src/lib/exportUtils.ts > exportToPDFServer`의 `'print'` 경로가 **`await supabase.functions.invoke(...)` 호출 후 `window.open()`** 을 부릅니다. 사용자 제스처 컨텍스트가 끊어져 **브라우저 팝업 차단**에 걸리고, "PDF가 열리지 않는다"는 토스트만 보입니다. `'download'` 모드도 실제로는 **HTML 파일**을 받게 되는데 메시지는 "PDF 파일이 다운로드되었습니다"로 표시돼 혼선이 큽니다.

### 3) 수정안 (build 모드 진입 시 적용)

A. **인쇄 흐름 재설계** (`exportToPDFServer`)
- 클릭 즉시 `window.open('about:blank', ...)` 으로 **동기 오픈** → 로딩 placeholder HTML 작성.
- 그 다음 edge function 호출 → 받은 HTML을 `printWindow.document.open/write/close` 로 주입.
- 팝업이 정말 차단된 경우(`!printWindow`)는 **HTML 다운로드 + 안내 토스트**로 graceful fallback.

B. **다운로드 모드 정직화**
- 현재 결과물이 HTML이므로 토스트 문구를 "인쇄용 HTML이 다운로드되었습니다. 더블클릭 → 브라우저에서 인쇄 → 'PDF로 저장'" 으로 교체.
- 파일 확장자 `.html` 유지하되 파일명 prefix를 `위험성평가_인쇄용_` 로 변경해 오인 방지.

C. **동일 패턴 일괄 점검**
- `WorkPlanDetail`, `WorkPermits`, `EmergencyDrills`, `Incidents` 등에서도 `exportToPDFServer / generate-workplan-pdf` 호출 시 동일한 비동기-후-`window.open` 패턴이 있는지 grep 후 모두 동기 오픈 패턴으로 통일.

D. **사용자 안내 1줄 추가**
- 인쇄 버튼 옆에 작은 hint: "팝업 차단 시 주소창 아이콘에서 허용해 주세요."

E. **회귀 확인**
- 시나리오 `core12.risk_assessment_smoke` 에 인쇄 호출 단계 추가(팝업 핸들 반환 여부만 체크).

### 4) 결과
- 위험성평가 [인쇄] 버튼 → 새 창에서 즉시 로딩 → 자동 인쇄 다이얼로그.
- [PDF 다운로드] → HTML 다운로드 후 브라우저 인쇄→PDF 저장(메시지/파일명 정확).
- 팝업 차단 사용자도 HTML로 자동 폴백되어 "열리지 않는다" 토스트 사라짐.

승인하시면 build 모드에서 A~E를 한 번에 반영하겠습니다.