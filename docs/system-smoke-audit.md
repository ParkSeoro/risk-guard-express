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
| P0 | 프로젝트 생성 시 `role` → `role_new` |
| P0 | 초대코드 가입 → `process_invite_code` RPC |
| P0 | 초대 기본 role `contractor`(invalid) → `worker` |
| P0 | 모바일 위험성평가 `company_id` 필터 제거 |
| P0 | 모바일 조치 `company_id` 필터 제거 |
| P1 | 결재/검증/점검에서 soft-delete 필터 |
| P1 | 작업계획서 회차 select `title` → `period_label` |

## Still open (needs secrets / later)

| Severity | Issue | Action |
|--|--|--|
| P0 | AI: Edge Function에 `NVIDIA_API_KEY` / `GEMINI_API_KEY` 없음 | Supabase Secrets에 키 등록 필요 (당신이 키 제공 시 제가 등록) |
| P1 | 날씨: `OPENWEATHER_API_KEY` / `KMA_API_KEY` 없음 | 선택 |
| P1 | 이메일: `RESEND_API_KEY` 없음 | 선택 |
| P1 | 푸시: VAPID/FCM 없음 + `app.settings.*` 미설정 | 선택 |
| P1 | 회사 목록이 아직 `companies.project_id` 기준인 화면 다수 | 다음 PR에서 `project_companies` SSOT로 통일 |
| P2 | 마스터 공정/위험라이브러리 시드 비어 있음 | 사용하면서 채우거나 시드 |

## How to verify after Merge

1. PR Merge → Vercel Ready
2. 로그인 → 프로젝트/업체/초대코드 생성
3. 위험성평가 회차 1건 생성
4. AI 버튼은 시크릿 넣기 전까지 실패가 정상
