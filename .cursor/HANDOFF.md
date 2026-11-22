# SafeNex — 새 채팅용 맥락

2026-11-04 전부개정된 「사업장 위험성평가에 관한 지침」과 시스템 차이는 `docs/risk-assessment-guideline-2026-11-04.md` 이다. 반박은 그 파일에 덧붙인다. 이 문서를 이유로 위험성평가 화면을 바로 고치지 않는다.

의회·메신저 위치·이번 AAB에 넣을 범위에 대한 의견은 `docs/ai-work-log-and-app-chrome-2026-11-12.md` 이다. 반박은 그 파일에 덧붙인다.

업데이트 채널의 현재 결론은 `docs/update-channels-2026-11-12.md` 이다. `min_native_version`은 478이고, Play에서 사용자가 그 번호를 받기 전에는 올리지 않는다.

K-엑사원 2.5는 현장 버튼의 기본 모델이 아니다. 배치는 `docs/k-exaone-2.5-placement.md` 이다. 약관과 유료 단가가 확인되기 전에는 라우트·시크릿·설정 화면을 만들지 않는다.

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

## 운영 중 — 멈추면 안 됨 (2026-10-22)

지금은 테스트 단계가 아니다. 각 현장에서 배포본을 쓰고 있다. 기능을 넣거나 고칠 때 **그 기능만이 아니라, 같은 저장 경로로 실제 문서를 만드는 동작**까지 확인하고 끝낸다. 라이브 DB 트리거·함수를 올리기 전에, 정상 허가서·위험성평가·TBM·작업계획서 삽입이 되는지 롤백 테스트로 확인한다.

2026-10-22 사고: `__QA__` 시험 문서를 숨기려던 `hide_system_test_document()` 가 `NEW.period_label` 처럼 **그 테이블에 없는 칸**을 읽어, 허가서·위험성평가·TBM 생성이 실패했다. 라이브 함수는 `to_jsonb(NEW)` 로 고쳐 두었다. 고친 뒤 13:40(한국시간)에 실제 회차·허가서 생성이 다시 됐다.

**main 의 마이그레이션 파일은 아직 깨진 CASE 다.** `435c5d47` 수정은 `cursor/hide-qa-docs-94b9` 에만 있고 main 에는 없다. 그 파일을 다시 적용해 라이브 함수를 덮어쓰지 말 것. 다음 채팅에서 이 커밋을 main 에 올리는 것은, 사용자가 그 이슈를 열었을 때만.

## 제품

- **SafeNex**: 한국 건설현장 안전관리 SPA. UI는 한국어.
- 스택: Vite + React + TypeScript + shadcn + Tailwind. 패키지 매니저는 **Bun** (`bun.lock`).
- 백엔드: 로컬 없음. **원격 Supabase** (`VITE_SUPABASE_*`). 마이그레이션은 repo `supabase/migrations/` + 라이브 적용이 따로 있을 수 있음.
- 모바일: Capacitor / PWA / OTA. 웹 수정만 할 때는 native 빌드 불필요.
- 핵심 도메인: 위험성평가, 작업계획서, 작업허가서(+TBM), 통합 결재, 안관비, 근로자/QR, GPS·지오펜스, 순찰, 공지.

기능별 완료 정의는 `docs/feature-cards/` (일부가 코드보다 오래됨. 카드와 코드가 다르면 **코드를 SSOT**로 봄).

## 이 레포에서 일하는 방식

- **승인 후 코딩 (기본).** 오류·수정·개발 요청 시 원인과 해결책을 먼저 제시하고, 승인한 뒤에만 착수한다.
- 브랜치: `cursor/<descriptive-name>-94b9` (소문자).
- PR: `ManagePullRequest`, 기본 draft, base는 `main`.
- 문서 결재 후는 **하드락**. 상신·승인본을 함부로 고치지 말 것.
- 회사/프로젝트 스코프와 RLS를 깨지 말 것. SM이 전 회사 데이터가 아님.
- 허가서 AI는 **양식에 적힌 사실만**. 종류 이름만 보고 위험을 만들지 말 것.
- 안관비 당월 신규 작성은 증빙 패키지 있음. **이관(최초본)은 증빙 없음**.
- **근로자 현장 등록 QR 가입은 승인 없이 즉시 active.** 관리자 가입만 pending.
- 전체 `bun run lint`는 `no-explicit-any` 때문에 원래 실패하는 것이 정상.
- Cursor MCP: 공식 Vercel 원격 서버는 `.cursor/mcp.json` (`https://mcp.vercel.com`). Cursor의 **Needs login**으로 OAuth. AWS Deployments는 기본 켜지 않음.
- GPS 개소: 관제맵 [2]에서 이름+다각형/원/네모(선만). 여러 개소는 합집합. 출퇴근은 도형 안 또는 바깥 100–300m. 개소가 있으면 주소핀·단일 테두리보다 우선. 프로젝트 설정의 GPS 개소 카드는 목록+관제맵 링크만.

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

## 2026-10-22 에 main 에 있는 것

- PR #567 로그인: 앱은 관리자(이메일) 탭으로 연다. 근로자 탭은 등록 QR 또는 전화번호 기억이 있을 때만.
- PR #566 직책: 공사부장·공사담당·직장/조장은 왼쪽 권한(role)을 현장소장/작업자로 덮지 않는다.
- PR #565 위험성평가 공유 서명: 회차(`run_id`)마다 따로 받는다. 같은 주·유형으로 묶지 않는다.
- PR #568 허가서 전회차 복사: 연장 신청(`work_extend_requested_*`)과 이전 연장 도장은 복사하지 않는다. 10/21 대웅CT 허가서에 붙어 있던 20일 18:30 연장 대기는 라이브에서 제거했다.
- PR #569 `__QA__` 시험 문서 숨김. 위 사고 참고. 시험 공유 서명만 서명 대장에서 뺐고, 실제 서명은 그대로다.

## 2026-11-21~22 에 main 에 있는 것 (Antigravity ↔ Cursor 합동 작업)

- **Google One(Drive) 장기 백업·복원 완료** (Issue #683 · PR #684 종료):
  - `safenex-nightly-gdrive-backup` (`pg_cron`, 매일 `02:05~03:55 KST` 10분 간격 12틱) → `backup-storage-to-gdrive` v5 (틱당 최대 15건/50MB, 30일 경과 파일 백업, 서킷브레이커, `archive-restore-cache` 24시간 초과분 Storage API 정리).
  - UI 아카이브 복원 Fallback 강화 (`src/lib/archiveUrlResolver.ts`, 인쇄/사진 팝업 포함) 및 `www.safenex.org` 실서버 E2E 복원 검증 완료.
- **실화면 7개 모듈 전수 QA 12건 일괄 수정·배포·실서버 검증 완료** (RFC #688 종료):
  - **Batch 1 (P0 5건, PR #689)**: TBM 참여자 `0명` 버그 수정(embedded count + 50행 페이지네이션), 과거 비초안 문서 인쇄/PDF 작성관리자 차단 해제(`generate-pdf` v31), 안전점검 목록 `PGRST200` 400 오류 해소, 결재 반려 탭·KPI 일치, 작업허가서 목록 작성자·복제 초기화 및 배정/신고 인원 표시 정리.
  - **Batch 2 (P1 4건, PR #690)**: 서명원장 TBM 제목·한글 공유 출처 표시, **안전점검 완료/결재중 일괄 잠금(마스터만 예외 — UI + DB 트리거, `assessment_runs`/`risk_items`/`work_plans` 하드락 유지)** 및 `FAC-06` 오타 수정, 위험성평가 반려 라벨·비편집 시 엑셀 차단, 작업계획서 `작업취소` 칩·중복 TBM 버튼 제거. (라이브 마이그레이션 2건 적용 완료)
  - **Batch 3 (P1 3건, PR #691)**: 안전관리비 검증 탭 한글화(`submitted`→`결재중`, 실 RPC 위반 코드 4종 포함)·회사명 배지·OCR 연도 오인식 경고, 상단 헤더 겹침/카드 버튼 잘림 해소, 한국어 조사(`은/는`) 및 종료(`종료완료`/`마감`/`CLOSED`)/취소 허가서 TBM 안내 문구 정상화.
- **텔레그램 새벽 작업 일일 리포트 개편** (PR #692 · #693):
  - 기존 2회/일(07:00·22:00 KST) GitHub Actions(`SafeNex Automated Health Check & Telegram Alert`, ID `401510706`) 비활성화(`disabled_manually`).
  - Supabase `pg_cron` (`safenex-nightly-telegram-report`, 매일 `06:30 KST` / `21:30 UTC` 1회) → `send-nightly-telegram-report` v5 + `public.get_nightly_ops_report()` (`service_role` 전용).
  - 리포트 내용: Google One 백업 실적·백업 대상 일자 범위·일일/누적 용량, 새벽 배치(`scan-work-plan-end-warnings`, `daily-consistency-audit`, `purge-worker-last-positions-0330-kst`) 결과. 텔레그램 시크릿(`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)은 Supabase Vault + `get_runtime_secret()`에 암호화 보관.
- **GPS 기반 위치·위험구역·출퇴근·분포 관제 전면 정비 완료** (PR #697~#703, Antigravity ↔ Cursor 전 PR 교차 리뷰 + 운영 Supabase 라이브 마이그레이션 6건 반영):
  - **PR 1-A (#697)**: `worker_zone_events` SELECT(`can_view_zone_event`, `workers.id` 직조인 + `can_read_company_data`)·UPDATE(`can_ack_zone_event`, 위험구역 푸시 수신 관리자와 1:1 일치: `project_admin`/`OWNER_PM`/`OWNER_CM` 전역, 그 외 관리 역할은 위반자 동일 회사 `pm.company_id = violator_company_id`만, `worker`/`viewer` 제외) RLS 정비 및 원본 불변 트리거(`guard_worker_zone_events_ack_update`), `docs/access-policy.md` 동기화.
  - **PR 1-B (#698)**: 대시보드 구역 경보 `event_type = 'unauthorized_entry'` 필터 + 3분 TTL(가짜 614건 제거), `ZoneEvents` `restricted_zones` 조인·미확인 경고 쿼리 분리·잔류 인원 최신 이벤트 기준 정확화·기간/유형 필터·`?project=` 스냅백 버그 수정.
  - **PR 1-C (#699)**: 현장 체류·금일 출역 `COUNT(DISTINCT worker_id)` SSOT 통일 (`get_worker_distribution_counts/positions`, `countOnSite`, `WorkerAttendance`, `MobileToday` `현재 현장 인원` RPC 직결).
  - **PR 1-D (#700)**: `get_gps_tracking_health` 분모를 오늘(KST) 미퇴근 출근자로 전환(`no_checkin` 제외, 전일 지속 `block_reason` 유지), `AdminTrackingHealth` 죽은 Wi-Fi 카드 제거·업체 필터 추가, `list_attendance_exceptions` `gps_blocked` 보정·`ppe_pending` 회사명 추가·예외보드 차단 사유 한글화.
  - **PR 1-E (#701)**: `WorkerDistribution` 원형(`radius`) 위험구역 24각 UV 투영 추가, 협력사 관리 역할 PC 위치 메뉴(`/worker-distribution`, `/zone-events`) 및 `ContractorGate` 개방.
  - **PR 2-A (#702)**: 위치 관제 3화면 공통 상단 KPI 바(`LocationControlBar`: 현장 체류·GPS 정상률·미확인 위험진입·활성 위험구역, 오류 시 `—` 표기·조회 범위 배지) 마운트, `SiteControlMap` 편집 전용 명확화 + 분포 바로가기, `/admin/tracking-health`·`/zone-events`를 관리 역할(`site_manager`/`supervisor`/`site_supervisor`/협력사 관리자 포함, `worker`/`viewer` 제외)로 정합화 + **DB RPC 3종(`get_gps_tracking_health`, `get_worker_distribution_counts/positions`) 선택 현장 `role_new` 강제**(다중 현장 우회 차단).
  - **PR 2-B (#703)**: `worker_zone_events.ack_note` 추가 + 확인 후 `ack_note` 포함 확인 필드 불변 트리거 강화, `ZoneEvents` 인라인 조치 메모 입력·확인자/시각/메모 표기 및 `worker_last_positions`×`restricted_zones` 실시간 체류·이탈 배지(`posMs < eventMs` 역방향 오판 차단), `WorkerExceptionBoard` 미퇴근 즉시 `정정` 링크(`status=no_exit`) 및 `출입정지자 현장 진입`(`suspended_site_entry`) 카드 추가.
  - 참고: 현재 실운영 현장 2곳은 활성 `restricted_zones`가 0건이므로, 추후 위험구역을 등록한 뒤 실제 단말 출입·경보 테스트 진행 예정.
- **협업/멀티 PC 참고**:
  - 다른 PC에서 이어서 작업할 때는 `ParkSeoro/risk-guard-express` 최신 `main`을 pull하고, Supabase MCP 로그인 및 `gh auth login` 후 새 채팅에서 `.cursor/HANDOFF.md`를 읽게 하면 동일 맥락으로 이어짐.
  - PR 리뷰 자동 협업 시 `@cursor`는 PR 본문이 아니라 **PR 코멘트(`gh pr comment`)**로 호출해야 안정적으로 트리거됨.

위평 AI 문안을 사람이 행마다 확인하게 하는 방안은 **이야기만 했고 구현하지 않았다.** 다음 채팅에서 이어서 만들지 말 것.

## 보류된 옛 메모 (지시가 없으면 시작하지 말 것)

아래는 2026-09-29 메모다. 현재 작업이 아니다.

## 다음 작업 (2026-09-29 월, 추석 연휴 후)

관제 중계를 **시드니 Lightsail → iwinv 서울**로 옮긴다. 사용자는 아직 iwinv 서버를 만들지 않음. CCTV는 지금 Lightsail에서 보임. 윈도우 SSH 키 등록에서 멈춤 — 월요일에 비밀번호 로그인 또는 키 생성을 다시 한다.

결정된 스펙 (아직 신청 전):
- `gna_2.4_n` 단독 2핵 4G, KR1-Z02, Ubuntu 24.04 LTS, VPC, NAT 없음, 공인 IP
- ELCAP `safenex-vision`: Inbound 22/80/443/1935, Outbound 53 TCP·UDP + 80/443 (+ UDP 123), 해외/봇 차단 없음
- 앱/웹은 카메라 1대 + 10분 HLS 정지 (PR #489). 카메라 RTMP는 그대로

같이 볼 것: **메일·저장소를 같은 iwinv에 둘지.** 결론 초안 — CCTV 박스에 같이 올리지 말 것. 메일은 25번/평판 때문에 별도(또는 지금 Supabase 메일 유지). 파일은 지금 `supabase.storage` (`attachments`). 50GB는 OS+Docker용. 녹화·문서 저장은 별도 디스크/오브젝트.

## 하지 말 것

- 사용자 승인 없이 오류 수정·기능 개발 코딩을 시작하지 말 것.
- 이 핸드오프를 이유로 무관한 리팩터를 시작하지 말 것.
- 승인본 이관에 OCR/항목별 증빙을 되살리지 말 것.
- 허가서 요약에 일반 건설 위험(추락·감전 등)을 공종만 보고 넣지 말 것.
- 전체 lint “통과”를 목표로 수천 개 any를 고치지 말 것.
- 크레인 하중표를 추정·보간해 넣지 말 것. 제조사 제원표/LMI만.
