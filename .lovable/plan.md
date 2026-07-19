## 목표
표준허가서 양식(복제)에서 우측 "요구사항" 열의 누락된 체크박스를 AI 재분석으로 자동 채우고, 기존 사용자가 배치한 박스는 보존한다.

## 원인 분석
현재 `analyze-permit-template` 엣지 함수는 2단계(감지 → 검증) 패스를 돌리지만, 우측 컬럼(라벨 오른쪽에 나열된 □ 마커)을 놓치는 경우가 반복된다. 이는:
- Gemini 비전이 표 내부의 반복 □ 마커를 "장식"으로 오인
- 2차 검증 프롬프트가 "누락 보정"을 강조하지만 표 행 단위 스캔은 강제하지 않음
- AI 결과가 편집기에 병합될 때 겹침 검사가 새 체크박스를 기존 서명/텍스트 박스와 겹친다고 판단해 드롭할 수 있음

## 계획

### 1. 엣지 함수 프롬프트 강화 (`supabase/functions/analyze-permit-template/index.ts`)
- 시스템 프롬프트에 "표(테이블) 구조 우선 스캔" 규칙 추가:
  - 각 행의 좌측 라벨 셀 옆에 나열된 모든 □ 마커를 개별 체크박스로 감지
  - 우측 컬럼(x > 0.55) 체크박스는 라벨 텍스트 없어도 반드시 반환 (라벨은 좌측 행 라벨 계승)
- 2차 검증 패스에서 "표 각 행별 체크박스 개수 재확인" 지시 추가
- 진단(diagnostics)에 `table_rows_scanned`, `checkboxes_per_row` 통계 노출

### 2. 3차 "table sweep" 패스 추가
1차/2차 후 체크박스 총 개수가 15개 미만이거나 우측(x>0.5) 체크박스가 5개 미만이면 3차 패스 자동 실행:
- Gemini Flash에게 "표 각 행 좌→우 스캔, □ 심볼만 좌표로 반환" 전용 프롬프트
- 결과를 기존 체크박스와 IoU < 0.3 조건으로 dedupe 후 병합

### 3. 프론트 병합 로직 개선 (`src/pages/SettingsPermitForms.tsx`의 `applyAIResult`)
- 사용자 수동 박스: 그대로 보존
- 이전 AI 박스: 새 AI 결과로 교체
- 신규 AI 체크박스가 기존 서명/텍스트 박스와 겹치는 경우 → 드롭하지 말고 z-order를 위로 올려 유지 (겹침 경고만 표시)

### 4. 재분석 UX (`AIAnalysisPanel.tsx`)
- 미리보기 다이얼로그에 "우측 컬럼 체크박스 개수" 배지 추가
- 5개 미만이면 자동으로 3차 sweep 실행 표시

### 5. 검증
- 사용자가 대상 템플릿 열고 "AI 자동 분석 실행" → 미리보기에서 우측 체크박스 채워졌는지 확인 → 적용
- diagnostics 로그로 각 패스별 감지 개수 콘솔에 출력

## 기술 세부
- 파일 수정: `supabase/functions/analyze-permit-template/index.ts`, `src/pages/SettingsPermitForms.tsx` (`applyAIResult` 병합 로직), `src/components/permit-designer/AIAnalysisPanel.tsx` (진단 배지)
- 대상 템플릿을 사용자가 특정하지 않았으므로, 개선은 **모든 양식에 적용**되고 사용자는 해당 (복제) 양식을 열어 "AI 자동 분석 실행" 버튼만 누르면 된다.
