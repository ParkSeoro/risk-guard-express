## 문제 진단

첨부 상태: "AI 분석 완료 · 필드 0개, 체크박스 0개, 서명 0개"

즉 엣지 함수 호출은 성공했지만 **AI가 이미지에서 아무 요소도 인식하지 못한 채 빈 JSON을 반환**하고 있습니다. 원인 후보:

1. **저해상도 렌더링** — 현재 `AIAnalysisPanel`은 PDF를 `scale: 1.4` + JPEG 60%로 렌더링. 한국어 허가서의 얇은 표선/작은 라벨은 이 화질에서 Gemini Flash가 못 읽는 경우가 많음.
2. **모델 선택** — Lovable Gateway `google/gemini-2.5-flash`는 속도 우선이라 표·체크박스 OCR이 약함. Gemini 2.5 **Pro**가 한국어 양식 인식률이 훨씬 높음.
3. **원시 응답 미로깅** — 함수가 raw response를 안 찍어서 "모델이 뭐라 답했는지"를 볼 수 없어 사일런트 실패.
4. **결과 0개인데도 빌더로 강제 이동** — 사용자 입장에서 "기능 안 됨"으로 보임. `sec_ai_*` 섹션이 아예 안 만들어져서 빌더에 아무것도 없어 보이는 것.

## 수정 계획

### 1) `supabase/functions/analyze-permit-template/index.ts`
- **모델을 `google/gemini-2.5-pro`로 승격** (Gateway 우선). 실패 시 `gemini-2.5-flash` → 사용자 `GEMINI_API_KEY`의 `gemini-2.5-pro` 순 3단 폴백.
- Gateway 호출 함수에 `model` 파라미터화, `response_format: json_object` 유지.
- **원시 응답 로깅**: `console.log('[analyze] raw:', raw.slice(0, 800))` 및 파싱 실패 시 전문 로그.
- **응답에 진단 필드 추가**: `{ result, layoutPatch, overlayPatch, signatureSlots, diagnostics: { model_used, raw_preview, page_count, image_bytes_total } }`.
- 프롬프트 강화: "각 페이지에 최소 1개 이상의 필드/체크박스/서명 후보를 반드시 나열하라. 아무것도 인식되지 않으면 그 페이지의 이유(예: 백지·이미지 없음)를 `notes`에 기록하라." + `notes: string[]` 필드 추가.
- 안전장치: 파싱 결과 총합이 0이면 400이 아닌 200 반환하되 `diagnostics.reason = 'no_elements_detected'` 세팅.

### 2) `src/components/permit-designer/AIAnalysisPanel.tsx`
- **렌더링 해상도 상향**: `scale: 1.4 → 2.2`, JPEG `0.6 → 0.85`.
- 페이지당 base64 크기가 4MB 초과 시 자동으로 스케일 낮춰 재시도 (Gateway 페이로드 한도 안전).
- 결과 0개 케이스 처리:
  - `onApply` 호출 **안 함** (빌더로 이동 X, 기존 layout 유지)
  - 대신 경고 토스트 + 진단 정보 표시:  
    "인식 실패 — 사용한 모델: {model_used}. PDF 스캔 품질이 낮거나 텍스트가 아닌 이미지 위주일 수 있습니다. 원본 PDF 오버레이 탭에서 수동 배치를 이용하세요."
  - 디버그용으로 콘솔에 `diagnostics` 전문 출력.
- 진행 표시에 현재 사용 중인 모델명 노출.

### 3) `src/pages/SettingsPermitForms.tsx` — `applyAIResult`
- 방어 로직: `res.layout.sections`와 `res.overlay.pages`가 모두 비어있으면 setTab('builder')로 이동하지 않고 no-op + 토스트.
- 결과가 있을 때만 기존처럼 병합·이동.

### 4) 검증
- 사용자가 다시 "AI 자동 분석 실행" 클릭 → 엣지 로그에서 `[analyze] raw:` 확인 → 실제 Gemini 응답 내용으로 다음 조치 판단 가능.
- Pro 모델로도 0개면 원인은 PDF 자체(스캔 이미지 품질/한글 폰트 임베딩 없음)임이 확인되므로, 사용자에게 명확히 안내.

## 기술 세부 (참고)

- Gateway 호출 함수 시그니처를 `callLovableAIGateway(messages, { model, temperature })`로 변경.
- `pageImages` 총 바이트 수를 계산해 25MB 초과 시 400 반환(현재는 페이지 수만 6장 제한).
- `permit_form_templates.ai_analysis_json`에 `diagnostics`도 함께 저장하여 재현 분석 가능.

이 계획을 승인해 주시면 위 3개 파일을 수정하고, 실제 재실행 시 나오는 raw 로그로 후속 조치까지 이어가겠습니다.