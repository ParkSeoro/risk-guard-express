# 내 소유 Supabase로 이전 (Lovable Cloud 유지)

Lovable Cloud 프로젝트 `iqtiozscqwuacgzrlfzu` 는 **삭제·수정하지 않습니다.**
앱이 당분간 그쪽으로 붙어 있어도 되고, 새 프로젝트가 준비되면 Vercel/로컬 env 만 바꿔 cutover 합니다.

## 왜 대시보드에 안 보였나

| | Lovable Cloud (현재) | 내 Supabase (목표) |
|--|--|--|
| Project ref | `iqtiozscqwuacgzrlfzu` | 새로 만들 ref |
| 소유 | Lovable | 본인 계정 |
| 대시보드 | 안 보임 (정상) | 보임 |
| 과금 | Lovable 쪽 | Supabase Billing |

## 전체 흐름

```
[1] 내 계정에 빈 프로젝트 생성
[2] 이 레포 migrations 를 새 프로젝트에 push
[3] Storage 버킷 보장 + Edge Functions 배포
[4] (선택) Lovable 데이터/파일/유저 복사
[5] Vercel·로컬 env 를 새 URL/키로 전환
[6] Lovable 은 백업으로 그대로 둠
```

---

## 1) 새 프로젝트 만들기 (직접)

### 이미 만든 대상 프로젝트

| | 값 |
|--|--|
| Ref | `qhntxmggacorqjjmjqgo` |
| URL | `https://qhntxmggacorqjjmjqgo.supabase.co` |
| Publishable key | 로컬 `.env.local` 에만 보관 (커밋 안 함) |
| Lovable (백업) | `iqtiozscqwuacgzrlfzu` — **수정 금지** |

### 스키마 push에 아직 필요한 것

CLI `supabase link` / `db push` 는 아래가 있어야 합니다 (채팅에 붙여 주세요):

1. **Access Token** — https://supabase.com/dashboard/account/tokens → Generate  
2. **Database password** — 프로젝트 만들 때 설정한 DB 비밀번호  
   (Settings → Database 에서 reset 가능)

`service_role` / `sb_secret_...` 은 Functions·데이터 이전 단계에서만 필요합니다.

---

## 2) 스키마 적용 (레포 → 새 프로젝트)

레포에 이미 `supabase/migrations/` (170+) 가 있으므로 **스키마는 코드가 소스**입니다.

```bash
# 1회: Supabase CLI 로그인
npx supabase login

# 새 프로젝트 연결 (ref = API 설정의 Reference ID)
npx supabase link --project-ref <NEW_REF>

# 마이그레이션 push
npx supabase db push
```

또는 헬퍼:

```bash
export SUPABASE_ACCESS_TOKEN=...          # https://supabase.com/dashboard/account/tokens
export NEW_PROJECT_REF=xxxx
./scripts/migrate-own-supabase/provision-new-project.sh
```

실패 시 보통 원인:
- `pg_cron` / `pg_net` 미허용 → Dashboard → Database → Extensions 에서 enable 후 재시도
- 이미 일부 객체가 있음 → 빈 프로젝트에서만 실행할 것

---

## 3) Storage 버킷

앱이 쓰는 버킷:

| Bucket | public | 용도 |
|--|--|--|
| `attachments` | true (현행) | 첨부/증빙/사이트맵 등 |
| `project-library` | false | 자료실 |
| `permit-form-assets` | false | 허가서 양식 PDF |
| `app-updates` | false | OTA 패키지 |

마이그레이션에 `attachments` INSERT만 있는 경우가 있어, push 후 아래를 SQL Editor에서 실행:

```bash
# 파일: scripts/migrate-own-supabase/ensure-buckets.sql
```

Dashboard → SQL → 붙여넣기 실행.

---

## 4) Edge Functions 배포

```bash
npx supabase functions deploy
# 또는 개별:
# npx supabase functions deploy track-location
# npx supabase functions deploy dispatch-notification-push
# ...
```

**Secrets** (Dashboard → Edge Functions → Secrets 또는 CLI):

| Secret | 비고 |
|--|--|
| (자동) `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | 보통 플랫폼이 주입 |
| AI/외부 API 키 | Lovable에 있던 것과 동일하게 복사 |
| Push / Capgo / 이메일 등 | 사용 중이면 동일 복사 |

푸시 트리거용 (unified push migration 참고):

```sql
ALTER DATABASE postgres SET app.settings.supabase_url = 'https://<NEW_REF>.supabase.co';
ALTER DATABASE postgres SET app.settings.service_role_key = '<SERVICE_ROLE_JWT>';
```

---

## 5) 데이터 이전 (선택)

**Lovable Cloud는 그대로 둡니다.** 복사만 합니다.

### 현실적인 선택지

**A. 데이터 최소 / 새로 시작 (가장 안전·빠름)**  
- 스키마만 새 프로젝트에 올리고 master 계정·프로젝트 다시 세팅  
- 파일은 필요 시 수동 재업로드  
- Lovable은 열람용 백업

**B. 테이블 CSV 수동 이전**  
1. Lovable Cloud → SQL / Table editor 에서 주요 테이블 Export  
2. 새 Supabase Table editor / `COPY` 로 Import  
3. `auth.users` 는 CSV로 그대로 옮기기 어려움 → 사용자 재가입 또는 Auth Admin API

**C. 마이그레이션 툴 (풀 카피)**  
커뮤니티 exporter (예: Lovable Cloud → own Supabase)로 DB+Storage+Auth 이전.  
Lovable에 임시 Edge Function을 올려 service role/DB URL을 꺼내는 방식이라, **끝나면 그 함수는 반드시 삭제**하고 Lovable 쪽 키 로테이션을 권장.

우선 **A 또는 B** 로 cutover 하고, 파일이 많으면 C를 나중에 해도 됩니다.

---

## 6) 앱 연결 전환 (cutover)

### 로컬

- **지금 `.env` = Lovable 백업. 지우지 마세요.**
- 새 프로젝트용은 `.env.local` (gitignore 권장) 또는 임시로 `.env` 교체 전 복사본 보관:

```bash
cp .env .env.lovable.backup   # 로컬만, 커밋 금지
```

`.env.local` 예시:

```
VITE_SUPABASE_PROJECT_ID="<NEW_REF>"
VITE_SUPABASE_URL="https://<NEW_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<NEW_ANON_KEY>"
```

Vite는 `.env.local`이 `.env`보다 우선합니다 → Lovable `.env`는 파일로 남겨둔 채 새 프로젝트로 테스트 가능.

### Vercel

Project → Settings → Environment Variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

변경 후 Redeploy.  
문제 생기면 **예전 Lovable 값으로 되돌리면** 즉시 복구됩니다 (Lovable 유지 정책).

### 모바일 / Capgo

OTA·네이티브 빌드의 번들 env도 새 URL을 봐야 합니다. 웹 cutover 안정화 후 APK/IPA 재빌드 권장.

---

## 7) 전환 후 체크리스트

- [ ] 로그인 / 회원가입
- [ ] 프로젝트 목록
- [ ] 위험성평가 목록 (삭제분 미노출)
- [ ] 작업허가서 + 파일 업로드
- [ ] Storage public URL 동작
- [ ] Edge Function 헬스 (예: fetch-weather, send-push)
- [ ] 푸시/알림 (설정한 경우)
- [ ] Lovable URL로도 구 데이터 열람 가능한지 (백업 확인)

---

## 보안 메모

- `service_role` / DB password 는 Git에 넣지 말 것
- Lovable `.env` anon 키가 레포에 이미 있을 수 있음 → cutover 후 Lovable 쪽 키 로테이션은 Lovable 정책에 따름
- 이 브랜치는 **Lovable 프로젝트에 destructive SQL을 실행하지 않음**
