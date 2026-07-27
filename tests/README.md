# E2E (Playwright) — 권한·결재 진단

## 설치 (최초 1회)

```bash
npm install
npx playwright install chromium
cp .env.e2e.example .env.e2e
# .env.e2e 에 테스트 계정 3종 입력
```

## 실행

```bash
# .env.e2e 로드 + 테스트 (Vite dev 자동 기동)
npm run test:e2e

# 권한 가드만
npx playwright test tests/roles.spec.ts

# 전자결재 풀사이클만
npx playwright test tests/workflow-approval.spec.ts

# UI 모드
npm run test:e2e:ui

# 실패 리포트
npx playwright show-report
```

## 실패 시 보는 곳

1. **터미널** — `[LOGIN FAIL]`, `[ROUTE GUARD FAIL]`, `[WORKFLOW FAIL]`, `[UI FAIL]` 접두어와 URL
2. **`test-results/`** — 실패 시점 스크린샷·video·trace
3. **`npx playwright show-report`** — HTML 리포트  
   trace: `npx playwright show-trace test-results/.../trace.zip`

## 시나리오 요약

| 역할 | 파일 | 검증 |
|---|---|---|
| 일반 근로자 | `roles.spec.ts` | `/settings`, `/master-data`, `/safety-cost` → `/` 리다이렉트 |
| 협력사 소장 | 동일 | CTA·위험성평가/작업계획서 작성 버튼, 산안비 차단 |
| 원청 관리자 | 동일 | 주요 메뉴 진입, 결재 승인/반려 |
| 풀사이클 | `workflow-approval.spec.ts` | 협력사 상신 → 원청 승인 → 근로자 TBM/현장 목록 확인 |
