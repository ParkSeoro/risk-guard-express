# Supabase 마이그레이션 적용 — 출입 정지

파일: `supabase/migrations/20260801180000_worker_site_entry_suspension.sql`

모바일·데스크탑이 **같은 `workers` 컬럼 + 같은 RPC**를 쓰므로, DB에 한 번만 적용하면 양쪽이 동일해집니다.

---

## 방법 A — Supabase Dashboard SQL Editor (가장 쉬움)

1. https://supabase.com/dashboard 접속 → 프로젝트 `qhntxmggacorqjjmjqgo` (또는 현재 SafeNex 프로젝트) 선택  
2. 왼쪽 **SQL Editor** → **New query**  
3. 로컬 파일 내용을 전부 붙여넣기:
   - `supabase/migrations/20260801180000_worker_site_entry_suspension.sql`
4. **Run** 실행  
5. 성공 메시지 확인 후, 아래로 검증:

```sql
-- 컬럼 확인
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'workers'
  and column_name like 'site_entry%';

-- RPC 확인
select proname from pg_proc
where proname in ('set_worker_site_entry_suspension', 'is_worker_site_entry_blocked');
```

---

## 방법 B — Supabase CLI (로컬에서 push)

PC에 [Supabase CLI](https://supabase.com/docs/guides/cli) 설치 후:

```bash
# 1) 로그인 (브라우저)
npx supabase login

# 2) 프로젝트 연결 (Project Settings → General → Reference ID)
npx supabase link --project-ref qhntxmggacorqjjmjqgo

# 3) 미적용 마이그레이션 push
npx supabase db push
```

Access Token은 Dashboard → Account → Access Tokens 에서 `sbp_...` 형태를 발급합니다.

---

## 적용 후 확인

| 화면 | 확인 |
|------|------|
| 데스크탑 **근로자 관리** | 출입 열 · 정지(🚫) / 해제 버튼 |
| 모바일 **근로자 · 출입** | 동일 정지/해제 |
| 근로자 출근 / 회사 QR | 정지 시 `SUSPENDED` |

비활성(`is_active=false`)과 출입 정지는 다릅니다.

- **비활성**: 명단에서 빼는 소프트 삭제  
- **출입 정지**: 명단은 유지, 출근·QR만 막음 (1일/3일/영구 + 사유)
