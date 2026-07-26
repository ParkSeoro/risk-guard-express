## 목표
프로젝트 상태 파편화, 대시보드 필터 비대칭, 협력사/근로자 권한 혼용, 레거시 파일 4가지 결함을 지시된 조건에 따라 정확히 수정합니다. 지시 외 UI/디자인은 손대지 않습니다.

---

## 1. 프로젝트 상태(Project State) 단일화

`AppLayout.tsx`에 이미 정의된 `useGlobalProjectAccess`(ProjectAccessContext)를 SSOT로 사용합니다.

대상 파일과 현재 상태 → 변경 내용:

- **src/pages/WorkPermits.tsx** — `localStorage.getItem('selectedProjectId')` 직접 읽기 + `useProjectAccess()` 호출 중. 두 줄 제거 후 `useGlobalProjectAccess()`에서 `selectedProject`(as `projectId`)와 `userCompanyId`를 함께 구조분해.
- **src/pages/InspectionMode.tsx** — `localStorage.getItem('selectedProjectId')`만 사용 중. `useGlobalProjectAccess()`로 대체.
- **src/pages/LegalEducationMapping.tsx** — `useState(() => localStorage.getItem("selectedProjectId") || localStorage.getItem("currentProjectId"))` 제거. `useGlobalProjectAccess()`의 `selectedProject`를 그대로 사용(setState 의존성 제거로 헤더 변경 시 자동 리렌더).
- **src/pages/Approvals.tsx** — `useProjectAccess()` 호출을 `useGlobalProjectAccess()`로 교체(반환 시그니처 동일).
- **src/pages/Incidents.tsx** — 동일하게 교체.
- **src/pages/TbmLogs.tsx** — 동일하게 교체.
- **src/pages/WorkerEducation.tsx** — 동일하게 교체(`as any` 캐스팅 유지, `profile` 부분은 별도 소스 사용 여부 확인 후 그대로 둠).

결과: 헤더에서 프로젝트를 바꾸면 Context 값 변경 → 이 화면들의 `useEffect([projectId])`가 트리거되어 즉시 재조회.

---

## 2. Dashboard 필터/성능 최적화 (`src/pages/Dashboard.tsx`)

- **applyCompanyFilter 대칭 적용**: `fetchDashboard` 내 `work_plans`, `todo_items` 외에 `assessment_runs`와 `risk_items`(그리고 `high_risk_items` 등 파생 쿼리) 쿼리에도 동일하게 `applyCompanyFilter(query)`를 감싸 협력사 KPI가 일치하게 함.
- **의존성 배열 보정**: `fetchDashboard`를 호출하는 `useEffect`의 deps에 누락된 `applyCompanyFilter`, `userCompanyId`, `isMaster`, `isProjectAdmin`, `isContractor`, `selectedProject`를 명시. Stale Closure 방지를 위해 `fetchDashboard`는 `useCallback`으로 감싸고 동일 deps를 사용.
- **성능**: (a) `accessLoading`이 true인 동안은 fetch 스킵, (b) `selectedProject`가 비어 있으면 조기 return, (c) 동일 프로젝트에 대한 중복 호출을 방지하기 위해 최근 인자 시그니처를 `useRef`로 저장하고 동일하면 스킵하는 가벼운 가드 추가. React Query 도입 같은 큰 리팩터는 지시 범위를 벗어나므로 하지 않음.

---

## 3. Contractor / Worker 권한 로직 분리

문제: `useProjectAccess.ts`에서 `isContractor: isWorker`로 별칭 처리되어 있고, `Dashboard.tsx`의 `QuickStartCards`가 `isContractor` 하나로 두 역할을 동일하게 처리 중.

- **`src/hooks/useProjectAccess.ts`**: `isContractor` 계산을 `userCompanyType === 'contractor' && (userRole === 'project_admin' || userRole === 'safety_manager' || userRole === 'site_manager' || userRole === 'supervisor')` 로 재정의. `isWorker`는 기존 정의(`userRole === 'worker'`) 유지. legacy alias 주석은 제거하고 반환 객체에 둘 다 명확히 노출.
- **`src/pages/Dashboard.tsx` QuickStartCards**: props에 `isWorker` 추가. 분기 순서를 `isMaster → isProjectAdmin → isContractor(협력사 관리자: 위험성평가 작성/서류 제출 카드) → isWorker(교육 이수·서명·조회 전용 카드) → 기본` 로 명시적 if/else 재작성. 각 분기의 카드 리스트는 역할에 맞는 액션만 노출(디자인/스타일은 기존 그대로).

---

## 4. 레거시 파일 처리

- **src/pages/RiskAssessment.tsx** 삭제. 사전 확인: `rg "RiskAssessment"` 로 App.tsx 라우팅과 import 참조가 없는지 검증 후 `rm`. 참조가 남아 있으면 해당 import/라우트도 함께 제거.

---

## 기술 세부사항

- Context Hook 이름/경로: `import { useGlobalProjectAccess } from '@/components/AppLayout'` (이미 존재). 반환 타입은 `ProjectAccess`로 `useProjectAccess()`와 동일하므로 필드 사용부 변경 불필요.
- `selectedProject` → `projectId` 별칭이 필요한 파일은 구조분해 시 `{ selectedProject: projectId }` 형태로 매핑.
- `useEffect` deps는 ESLint react-hooks/exhaustive-deps 규칙을 만족하도록 완결적으로 채움.
- `RiskAssessment.tsx` 삭제 시 lazy import·라우트 문자열까지 정리해 라우팅 꼬임을 방지.

## 검증

- 헤더에서 프로젝트 전환 → 대상 7개 페이지가 새 프로젝트 데이터로 즉시 갱신되는지 수동 확인.
- 협력사 계정으로 Dashboard 접속 → 위험성평가 카드가 협력사 소속으로 필터링되어 표시되는지 확인.
- `tsgo` 타입체크 통과.
