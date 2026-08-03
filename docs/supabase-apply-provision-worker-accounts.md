# Supabase: 근로자 로그인 계정 자동 생성

## 1) SQL
파일: `supabase/migrations/20260803080000_lookup_auth_user_by_email.sql`

SQL Editor에서 실행.

## 2) Edge Function 배포
```bash
supabase functions deploy provision-worker-accounts
```

`config.toml`에 `verify_jwt = false` (함수 내부에서 JWT·권한 검증).

## 동작
- 일괄등록 후 Auth 계정 자동 생성
- 아이디: 전화번호 (`{digits}@worker.local`)
- 비밀번호: 전화번호 뒤 4자리
- 이미 Auth가 있으면 **비밀번호는 유지**, 프로젝트 멤버만 연결
