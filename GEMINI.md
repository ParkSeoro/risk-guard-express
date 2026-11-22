# SafeNex — Antigravity 공유 기억 & 운영 규칙 (Multi-PC Auto-Loaded)

이 파일은 어느 PC에서 `ParkSeoro/risk-guard-express` 저장소를 열어도 Antigravity가 새 대화 시작 시 자동으로 읽는 공유 기억 파일입니다.
세부 변경 이력과 최신 배포 상태는 `.cursor/HANDOFF.md`를 함께 확인하세요.

---

## 1. 사용자 & 커뮤니케이션 스타일
- **사용자**: 박서로님 (`ParkSeoro`, 플랫폼 마스터).
- **호칭/언어**: 항상 한국어로 간결·명확하게 답변하고, 호칭은 **박서로님**.
- **소통 방식**:
  - 불필요한 장황한 설명 대신 **핵심 원인 → 해결책 → 검증 결과** 중심으로 보고.
  - 수치·검증 결과는 추측하지 말고 실제 DB/로그/실서버 확인 근거를 제시.
  - 보안상 시크릿/토큰/JWT 원본은 코드·문서·대화 응답에 절대 출력하지 않음.

---

## 2. 운영 플랫폼 불변 원칙
- **실서비스 운영 중 (`https://www.safenex.org`)**: 테스트 프로젝트가 아니라 여러 건설 현장이 매일 사용 중.
  - 로그인, 위험성평가, TBM, 작업허가서, 안전점검, 작업계획서, 결재, PDF/인쇄에 회귀(regression) 절대 금지.
- **멀티테넌트 SaaS 원칙**: 특정 회사명·현장명 하드코딩 금지. 모든 권한·범위는 `project_id` / `company_id` / RLS 기반으로 처리.
- **결재 후 문서 잠금 원칙**:
  - `assessment_runs` / `risk_items` / `work_plans`는 결재 상신·승인 후 DB 하드락 유지.
  - `safety_inspections` 완료/결재중 잠금은 **마스터(`master`)만 예외** (UI + DB 트리거 일치).
  - 권한 정책 변경 시 `docs/access-policy.md`도 같은 PR에서 동기화.
- **패키지 매니저**: **Bun** (`bun install --frozen-lockfile`, `bun x vitest run ...`). `npm` 사용 금지.
- **원격 인프라**:
  - GitHub: `ParkSeoro/risk-guard-express`
  - Supabase Project ID: `qhntxmggacorqjjmjqgo` (로컬 DB 없음, 원격 라이브)
  - Vercel: `main` 머지 시 `https://www.safenex.org` 자동 배포

---

## 3. 협업 & 배포 워크플로우
- **기본 원칙 (`AGENTS.md` 준수)**: 새 개발/수정 요청 시 원인 파악 → 해결책 제시 → 승인 후 구현. (단, 박서로님이 바로 진행·머지를 지시한 경우 즉시 처리)
- **Antigravity ↔ Cursor PR 교차 리뷰**:
  - PR 생성 후 Cursor Cloud Agent를 호출할 때는 PR 본문이 아니라 **PR 코멘트(`gh pr comment`)에 `@cursor`**를 멘션해야 안정적으로 트리거됨.
  - 리뷰 피드백 반영 + CI(`Undeclared names`, `Unit tests`, `Vercel`) 통과 + 양측 LGTM 확인 후 머지 안내.
- **Edge Function / DB 마이그레이션**:
  - Supabase 마이그레이션과 Edge Function 배포는 Supabase MCP(`apply_migration`, `deploy_edge_function`, `execute_sql`)로 라이브 반영하고, 동일 코드를 Git PR로 `main`에 동기화.
  - `generate-pdf` Edge Function은 `verify_jwt: true` 유지.
  - 비밀 키는 코드에 넣지 않고 Supabase Vault + `public.get_runtime_secret()`(`service_role` 전용) 사용.

---

## 4. 주요 운영 자동화 현황 (2026-11-22 기준)
- **Google One(Drive) 장기 백업**:
  - `pg_cron` `safenex-nightly-gdrive-backup` (매일 `02:05~03:55 KST`, 10분 간격 12틱) → `backup-storage-to-gdrive` v5 (30일 경과 파일 백업, 틱당 최대 15건/50MB, 서킷브레이커, `archive-restore-cache` 24h 초과분 Storage API 정리).
  - UI 아카이브 복원 Fallback: `src/lib/archiveUrlResolver.ts`.
- **텔레그램 일일 리포트**:
  - 기존 2회/일 GitHub Actions (`SafeNex Automated Health Check & Telegram Alert`, ID `401510706`)는 **비활성화(`disabled_manually`)**됨.
  - 신규 `pg_cron` `safenex-nightly-telegram-report` (매일 `07:00 KST` 하루 1회) → `send-nightly-telegram-report` v5 + `public.get_nightly_ops_report()`.
  - 리포트 내용: Google One 백업 실적·백업 대상 일자 범위·용량 + 새벽 정기 배치(`scan-work-plan-end-warnings`, `daily-consistency-audit`, `purge-worker-last-positions-0330-kst`) 결과.

---

## 5. 멀티 PC 기억 동기화 규칙
- 큰 기능 완료, 정책 결정, 인프라/스케줄 변경이 끝나면 `.agents/skills/sync-memory/SKILL.md` 절차에 따라 `.cursor/HANDOFF.md` 및 `GEMINI.md`를 갱신해 `main`에 머지한다.
- 다른 PC에서 새 대화를 시작할 때는 필요 시 `git fetch origin`으로 `main` 최신 여부를 확인하고, 이어서 진행할 맥락이 필요하면 `.cursor/HANDOFF.md`를 먼저 읽고 시작한다.
- 박서로님이 **"기억 저장해줘 / 동기화해줘 / 다른 PC에서 이어할게"**라고 하면 즉시 `sync-memory` 스킬을 실행해 현재 세션의 결정·완료 내역을 `main`에 반영한다.
