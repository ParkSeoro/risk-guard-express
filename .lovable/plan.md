# 위험성평가 AI 생성 시스템 고도화

기존 `generate-risk-ai` edge function과 `riskAutoGenAI.ts`를 확장하여 7개 영역을 단계적으로 개선합니다. 신규 프로젝트 생성 없이 기존 구조 위에 얹습니다.

---

## Phase 1 — DB 스키마 확장 (Migration)

신규 테이블만 추가, 기존 테이블 변경 최소화. 모두 RLS 적용.

- **`ai_generation_jobs`** — 비동기 백그라운드 생성 작업
  - `id`, `project_id`, `run_id`(nullable), `created_by`
  - `process_name`, `equipment`, `work_description`, `target_count`(50/100/150/300)
  - `status` (`queued`|`running`|`partial`|`completed`|`failed`)
  - `total_batches`, `completed_batches`, `items_generated`
  - `quality_score`(numeric), `diversity_score`, `duplicate_rate`
  - `error_message`, `started_at`, `completed_at`
- **`ai_generation_logs`** — 입출력 로그 (오류 추적)
  - `job_id`(FK), `batch_index`, `prompt`(text), `raw_response`(jsonb)
  - `model`, `tokens_used`, `latency_ms`, `error`(text)
- **`ai_generated_items_buffer`** — 배치별 중간 결과
  - `job_id`(FK), `batch_index`, `items`(jsonb), `created_at`
- **`risk_user_corrections`** — 사용자 수정 학습 데이터
  - `project_id`, `process_name`, `original`(jsonb), `corrected`(jsonb)
  - `field_changed`, `corrected_by`, `created_at`
- **`risk_knowledge_base`** — RAG 데이터 (법령/KOSHA/사고사례)
  - `source_type` (`law`|`kosha`|`accident`|`internal`)
  - `process_tags`(text[]), `equipment_tags`(text[])
  - `title`, `content`(text), `embedding_summary`(text — 키워드 추출)
  - `legal_reference` (조항)
- **`ai_test_runs`** — 테스트 엔진 결과 (마스터 전용)
  - `tested_by`, `test_type` (`generation`|`speed`|`quality`)
  - `input_params`(jsonb), `result`(jsonb)
  - `pass_fail` (`pass`|`fail`), `error_location`, `duration_ms`

RLS: 본인/마스터/프로젝트 멤버 패턴 (기존 `is_project_member`, `has_role` 활용).

---

## Phase 2 — 비동기 배치 생성 엔진

**Edge Function 신규**: `supabase/functions/risk-job-orchestrator/index.ts`
- POST `/start` — `ai_generation_jobs` 행 생성, 즉시 반환 (job_id)
- 백그라운드 `EdgeRuntime.waitUntil()`로 batch 분할 (30개 단위)
- 각 배치를 `Promise.all`로 병렬 실행 (최대 3 동시)
- 배치 완료마다 `ai_generated_items_buffer` insert + job progress update
- 완료 시 status `completed`, 실패 배치는 `partial`

**기존 `generate-risk-ai` 재활용** — 단일 배치 생성기로 유지, orchestrator가 호출.

**클라이언트 (`riskAutoGenAI.ts`)**:
- `startBackgroundJob(opts)` 함수 추가 → job_id 반환
- Realtime 구독으로 `ai_generation_jobs` row 변경 감지
- 진행률·중간 결과·완료 알림 toast

---

## Phase 3 — 공종 분해 + 다양성 보장

**신규 lib**: `src/lib/processDecomposer.ts`
- 입력 공종을 sub-process로 자동 분해 (예: 굴착 → 굴착·운반·정리·배수)
- KOSHA 표준 분류 매핑 테이블 내장
- 각 sub-process에 target_count 균등 분배

**중복 방지** (orchestrator 내):
- `(sub_task, hazard)` 키 정규화 후 jaccard similarity > 0.85 제거
- 다양성 스코어 = unique sub_task 수 / 총 항목 수

---

## Phase 4 — RAG 적용

**신규 Edge Function**: `supabase/functions/rag-search/index.ts`
- 입력: process_name, equipment, work_description
- `risk_knowledge_base` 키워드 매칭 (process_tags overlap + content ilike)
- 상위 N개 컨텍스트 반환

**`generate-risk-ai` 수정**:
- 호출 전 RAG 컨텍스트 fetch
- system prompt에 "[참고자료]" 섹션 주입 (법령 조항 + 사고사례 요약)
- 출력 `legal_basis` 필드에 RAG에서 가져온 조항 우선 매핑

**시드 데이터 마이그레이션**: 기존 `legalReferences`, `accident_cases` 테이블에서 `risk_knowledge_base`로 import.

---

## Phase 5 — 사용자 수정 학습

**훅 추가**: `src/hooks/useRiskItemTracking.ts`
- 위험성평가 항목 저장/수정 시 원본과 비교 → 변경 필드를 `risk_user_corrections` insert
- 주기적으로 빈도 높은 패턴을 RAG knowledge_base에 `internal` 소스로 승격 (마스터 수동 승인)

**기존 `RiskAssessment.tsx` 저장 로직에 hook 연결** (최소 침습).

---

## Phase 6 — 품질 점수 + 테스트 엔진

**신규 lib**: `src/lib/qualityScoring.ts`
- 반복율 = 1 - (unique hazards / total)
- 다양성 = unique sub_tasks / total
- 위험요인 분포 엔트로피 계산
- 종합 점수 (0~100)

**자동 호출**: orchestrator 완료 시 점수 계산 후 `ai_generation_jobs.quality_score` 업데이트

**신규 페이지**: `src/pages/AITestEngine.tsx` (마스터 전용 가드)
- 생성 테스트: 샘플 입력 → 정상 출력 검증
- 속도 테스트: 50/100 항목 생성 시간 측정
- 품질 테스트: 점수 임계값(70+) 검증
- PASS/FAIL 배지 + 오류 스택 표시
- 결과 `ai_test_runs` 저장

라우트 `/admin/ai-test` 추가, AppSidebar (마스터만) 노출.

---

## Phase 7 — 로그 시스템

- `ai_generation_logs` 자동 기록 (orchestrator + generate-risk-ai)
- 신규 페이지 `src/pages/AILogs.tsx` (마스터 전용)
- job별 펼치기 → batch별 prompt/response/error 확인
- CSV export 버튼

---

## UI 통합

기존 위험성평가 생성 다이얼로그(`AssessmentRunDetail.tsx`)에:
- 항목 수 선택: **50 / 100 / 150 / 300** (라디오)
- 생성 시작 → job_id 받음 → Progress bar 컴포넌트 표시
- "백그라운드 진행 중" 토글로 다른 작업 가능
- 완료 시 toast + "결과 보기" 버튼

신규 컴포넌트:
- `src/components/risk-ai/AIJobProgress.tsx` — 실시간 진행률
- `src/components/risk-ai/QualityBadge.tsx` — 점수 표시

---

## 기술 메모

- Edge Function 백그라운드: `EdgeRuntime.waitUntil(promise)` (Deno Deploy 패턴)
- 동시성: `p-limit` 대신 수동 chunk + Promise.all (3 concurrent)
- 모델: `google/gemini-3-flash-preview` 기본, 마스터 테스트에서 `gpt-5-mini` 비교 가능
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE ai_generation_jobs`
- 로그 보존: 30일 후 자동 삭제 cron (선택)
- RAG: 임베딩 없이 키워드/태그 매칭으로 시작 (pgvector 도입은 추후)

---

## 작업 순서

1. **Phase 1** — 마이그레이션 (테이블 + RLS + Realtime)
2. **Phase 2** — orchestrator 함수 + 클라이언트 job 트래킹 + UI 진행률
3. **Phase 3** — processDecomposer + 중복 제거
4. **Phase 4** — RAG 함수 + knowledge_base 시드 + prompt 주입
5. **Phase 5** — 사용자 수정 추적 훅
6. **Phase 6** — 품질 스코어링 + 테스트 엔진 페이지
7. **Phase 7** — 로그 뷰어 페이지

각 Phase 종료 후 빌드 가능 상태 유지. 기존 동기 생성 경로(`generateRiskItemsHybrid`)는 fallback으로 보존.
