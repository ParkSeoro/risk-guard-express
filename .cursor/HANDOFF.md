# SafeNex — 새 채팅용 맥락

이 파일은 **긴 대화 이력을 대체**한다. 새 채팅은 이 파일만 읽고, 이번 이슈만 고친다.
이전 Cloud Agent 창의 전체 로그를 다시 넣지 말 것.

## 새 채팅 첫 메시지 (복사용)

```
.cursor/HANDOFF.md 와 AGENTS.md 를 읽고, 이번 요청만 처리해.
이슈: (한 줄)
증상: (화면/역할/기대 vs 실제)
첨부: (스크린샷이 있으면 첨부)
```

규칙: **이슈 하나 = 채팅 하나.** 안관비·허가서·GPS를 한 창에서 이어서 하지 말 것.

## 승인 후 코딩 (기본)

오류·수정·개발 요청을 받으면 **바로 코딩하지 않는다.**

1. 원인을 파악한다.
2. 해결책을 제시한다 (어디를 어떻게 바꿀지, 무엇을 건드리지 않을지).
3. **사용자의 명시적 승인을 받은 뒤에만** 코딩에 착수한다.

“그냥 해 / 진행해 / 승인”은 그 이슈에만 유효하다. 상시 면제가 아니다.

## 제품

- **SafeNex**: 한국 건설현장 안전관리 SPA. UI는 한국어.
- 스택: Vite + React + TypeScript + shadcn + Tailwind. 패키지 매니저는 **Bun** (`bun.lock`).
- 백엔드: 로컬 없음. **원격 Supabase** (`VITE_SUPABASE_*`). 마이그레이션은 repo `supabase/migrations/` + 라이브 적용이 따로 있을 수 있음.
- 모바일: Capacitor / PWA / OTA. 웹 수정만 할 때는 native 빌드 불필요.
- 핵심 도메인: 위험성평가, 작업계획서, 작업허가서(+TBM), 통합 결재, 안관비, 근로자/QR, GPS·지오펜스, 순찰, 공지.

기능별 완료 정의는 `docs/feature-cards/` (일부가 코드보다 오래됨. 카드와 코드가 다르면 **코드를 SSOT**로 봄).

## 이 레포에서 일하는 방식

- **승인 후 코딩 (기본).** 오류·수정·개발 요청 시 원인과 해결책을 먼저 제시하고, 승인한 뒤에만 착수한다.
- 브랜치: `cursor/<descriptive-name>-8657` (소문자).
- PR: `ManagePullRequest`, 기본 draft, base는 `main`.
- 문서 결재 후는 **하드락**. 상신·승인본을 함부로 고치지 말 것.
- 회사/프로젝트 스코프와 RLS를 깨지 말 것. SM이 전 회사 데이터가 아님.
- 허가서 AI는 **양식에 적힌 사실만**. 종류 이름만 보고 위험을 만들지 말 것.
- 안관비 당월 신규 작성은 증빙 패키지 있음. **이관(최초본)은 증빙 없음**.
- **근로자 현장 등록 QR 가입은 승인 없이 즉시 active.** 관리자 가입만 pending.
- 전체 `bun run lint`는 `no-explicit-any` 때문에 원래 실패하는 것이 정상.

## 2026-08-31 기준 main에 올라간 최근 결정

`origin/main` 팁에 아래가 머지되어 있다 (PR #379~#384).

### 안관비 (산업안전보건관리비)

- 승인본 **이관** = OCR로 영수증을 읽는 것이 아님. **월 × 비목 1~9 금액**을 넣어 다음 달 항목별 누계(전월/금월/누계)가 맞게 함.
- RPC: `commit_safety_cost_legacy_import`. 항목은 비목당 1행, `source = 'legacy_import'`, 수량 0 (PPE 입고 아님), 상태는 바로 `approved`.
- 이관 UX는 넓은 9열 테이블이 잘려서 **월 카드**로 바꿈. 현재 작성 중인 달을 이관하지 말라는 안내가 있음.
- **이관 월은 항목별 증빙·지급대장·OCR 게이트 면제** (`isSafetyCostLegacyImport`). 당월 신규 작성은 기존처럼 증빙 패키지 필수.
- 금액/누계 SSOT는 `src/lib/safetyCost.ts`. 패키지 게이트는 `src/lib/safetyCostEvidencePack.ts`.

### 작업허가서 AI 요약

- 양식명 **「굴착·중장비 작업허가서」** 만 보고 굴착·붕괴를 만들지 말 것.
- 중장비는 일반 허가서 중장비 칸의 **투입장비** (`hz_heavy_equipment_name`).
- 굴착은 `hz_excavation` 또는 굴착 제원/굴착 안전조치가 있을 때만.
- 핵심: `supabase/functions/_shared/permitBriefing.ts` (웹은 `src/lib/permitBriefing.ts`가 re-export).
- 저장된 브리핑도 상세/결재 미리보기에서 `presentPermitBriefing`으로 다시 걸러 보여 줌.

### 결재 알림

- **반려** 푸시는 기안자 + 이미 `승인`한 앞단계만. 아직 안 온 상위 결재자에게 `approval_result`를 보내지 않음.
- 최종 승인 팬아웃은 기존과 같음.

### 문서

- 상신·승인 문서는 DB 하드락 + 상신 스냅샷.

## 아직 화면으로 못 확인한 것

새 채팅에서 “이어서” 하기 전에, 해당 화면을 직접 열어보는 것이 다음 작업이다.

1. 이관된 월(예: 2026-08 승인완료+이관) — 증빙패키지/자동검토 빨간 배지가 없어야 함. 올릴 수 없어도 요구하면 안 됨.
2. 허가서 AI 요약 — 중장비만 있고 굴착 체크/제원이 없으면 굴착이 나오면 안 됨. 투입장비 이름이 보여야 함.
3. 사용자가 작성 중이던 달을 이관한 적이 있음. 그달은 라이브 작성분과 이관분이 겹칠 수 있음. 새 이관은 **지난 승인본 월**만.

## 자주 만지는 파일

| 주제 | 위치 |
|---|---|
| 안관비 화면 | `src/pages/SafetyCost.tsx` |
| 이관 마법사 | `src/components/safety-cost/LegacyImportWizard.tsx` |
| 증빙 패키지 | `src/lib/safetyCostEvidencePack.ts`, `EvidencePackPanel.tsx` |
| 허가서 양식 | `src/components/permits/DigPermitForm.tsx` |
| 허가서 AI | `supabase/functions/_shared/permitBriefing.ts` |
| 결재 상신 | `src/components/approval/SubmitApprovalDialog.tsx` |
| 종류 SSOT | `src/lib/permitKinds.ts` (`excavation` 라벨 = 굴착·중장비) |
| 리깅 규격 | `src/lib/riggingHardwareCatalog.ts` (EN 1492-2 라운드슬링, Crosby G-2130 샤클) |

## 하지 말 것

- 사용자 승인 없이 오류 수정·기능 개발 코딩을 시작하지 말 것.
- 이 핸드오프를 이유로 무관한 리팩터를 시작하지 말 것.
- 승인본 이관에 OCR/항목별 증빙을 되살리지 말 것.
- 허가서 요약에 일반 건설 위험(추락·감전 등)을 공종만 보고 넣지 말 것.
- 전체 lint “통과”를 목표로 수천 개 any를 고치지 말 것.
- 크레인 하중표를 추정·보간해 넣지 말 것. 제조사 제원표/LMI만.
