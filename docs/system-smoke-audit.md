# System smoke audit (fresh own Supabase)

Date: 2026-07-27  
Live app: `https://risk-guard-express.vercel.app` → `qhntxmggacorqjjmjqgo`  
Decision: **start fresh** (no Lovable data import)

## Already fixed on Supabase (no Merge needed)

| Item | Status |
|--|--|
| Auth `site_url` → production Vercel | ✅ |
| Redirect allow list (Vercel + localhost) | ✅ |
| Email autoconfirm (signup without inbox wait) | ✅ |
| Storage buckets (4) | ✅ |
| Signup position enum mapping RPC | ✅ applied |

## Fixed in this PR (Merge required)

| Severity | Fix |
|--|--|
| P0 | Auth 직종 옵션 → `project_position` enum 정렬 |
| P0 | 프로젝트 생성 시 `role` → `role_new` (**live 번들에 아직 `role:"project_admin"` 잔존**) |
| P0 | 초대코드 가입 → `process_invite_code` RPC |
| P0 | 초대 기본 role `contractor`(invalid) → `worker` |
| P0 | 모바일 위험성평가 `company_id` 필터 제거 |
| P0 | 모바일 조치 `company_id` 필터 제거 |
| P1 | 결재/검증/점검에서 soft-delete 필터 |
| P1 | 작업계획서 회차 select `title` → `period_label` |
| P1 | 회사 목록 `project_companies` SSOT 헬퍼 (`fetchProjectCompanies`)로 주요 화면 통일 |
| P1 | 위험성평가 상세 `risk_items` soft-delete 필터 |
| P2 | systemTest REQUIRED_COLUMNS `role` → `role_new` |

## Verified working (authenticated master)

- 로그인 / `is_master` / 프로젝트·회사·멤버 조회
- 초대코드 생성 (`project_invites`, `is_active` 컬럼 없음 — UI도 미사용)
- 위험성평가 회차 생성 (`assessment_runs`, `company_id` 컬럼 없음 — UI도 미사용)
- 작업계획서 / 작업허가 / TBM / 근로자 / 알림 / 결재라인 / 결재 생성
- Edge 배포됨: `generate-risk-ai`, `fetch-weather`, `send-push`, `safety-assistant`, …

## Still open (needs secrets / later)

| Severity | Issue | Action |
|--|--|--|
| P0 | AI: `GEMINI_API_KEY` / `NVIDIA_API_KEY` 없음 → `generate-risk-ai` 500 | 키 등록 |
| P1 | 날씨: OpenWeather/KMA 키 없음 → `fetch-weather` 500 | 선택 |
| P1 | 이메일/푸시: Resend·VAPID·FCM + `app.settings.*` 미설정 | 선택 |
| P1 | `standard_risk_library` / `master_processes` 0건 | 시드 또는 사용하면서 채움 |
| P2 | 일부 화면 아직 `companies.eq('project_id')` 잔존 가능 | 점진 교체 |
| P2 | `psr1579@gmail.com`은 master이나 프로젝트 멤버 아님 | 필요 시 멤버 추가 |

## Live production gap (until this PR Merges)

Vercel 번들 확인:

- `project_members` insert에 `role:"project_admin"` 2곳 → **프로젝트 생성/일부 가입 실패**
- `process_invite_code`는 Auth 경로에 일부 존재하나 ProjectSelect 레거시 insert도 남아 있었음

## How to verify after Merge

1. PR Merge → Vercel Ready
2. 새 프로젝트 생성 → 본인이 `project_admin`으로 들어가는지
3. 초대코드 생성 → 다른 계정 가입
4. 위험성평가 회차 → 항목 추가 → 작업계획서 → 허가
5. AI/날씨 버튼은 시크릿 넣기 전까지 실패가 정상
