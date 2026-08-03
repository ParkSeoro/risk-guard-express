# Supabase: 허가서 연동 TBM 주관자 백필

파일: `supabase/migrations/20260803030000_backfill_tbm_leader_from_permit.sql`

허가서에 연결된 기존 TBM의 `leader_name`을 **허가서 작성자**로 맞춥니다.

## 적용 (SQL Editor)

1. Supabase Dashboard → **SQL Editor** → New query  
2. 위 마이그레이션 파일 **전체** 붙여넣기 → **Run**

## 검증

```sql
select ts.id, ts.title, ts.leader_name, wp.submitted_by_name, p.display_name as created_by_name
from public.tbm_sessions ts
join public.work_permits wp on wp.tbm_session_id = ts.id
left join public.profiles p on p.user_id = wp.created_by
where coalesce(ts.is_deleted, false) = false
order by ts.updated_at desc
limit 20;
```

`leader_name`이 상신자/작성자명과 같으면 OK입니다.
