# Lovable → 내 Supabase 데이터 이전 (1회용)

새 프로젝트 스키마는 이미 있습니다. **데이터(행/파일/유저)** 를 옮기려면
Lovable Cloud의 `service_role` 키가 필요합니다. (대시보드에는 안 보임)

## 당신이 할 일 (Lovable에서 1번)

1. https://lovable.dev 에서 **기존 SafeNex / risk-guard 프로젝트** 열기
2. 채팅에 아래를 **그대로 붙여넣고** 배포되게 하기:

```
Cloud Edge Function으로 migration-credential-bridge 를 만들어줘.
verify_jwt = false 로 배포하고, 코드는 아래 전체를 사용해.

(아래 코드를 그대로 index.ts 로 저장)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
const ACCESS_KEY = "Ku3YYTR673NcBslYjkw-o1qx5VwLNnHI";
serve(async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") || req.headers.get("x-migrate-key") || "";
  if (key !== ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  const body = {
    supabase_url: Deno.env.get("SUPABASE_URL") || null,
    service_role_key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null,
    anon_key: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || null,
    supabase_db_url: Deno.env.get("SUPABASE_DB_URL") || Deno.env.get("POSTGRES_URL") || Deno.env.get("DATABASE_URL") || null,
  };
  return new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
```

3. 배포된 함수 URL을 Cursor 채팅에 붙여넣기  
   예: `https://iqtiozscqwuacgzrlfzu.supabase.co/functions/v1/migration-credential-bridge`

4. 이전이 끝나면 Lovable에 **이 함수 삭제** 하라고 말하기

## 그다음 (에이전트가 함)

- 함수를 key와 함께 호출해 `service_role_key` 확보
- `scripts/migrate-own-supabase/copy-data.mjs` 로 테이블·유저·(옵션) 스토리지 복사
- 새 프로젝트에서 데이터 확인

## 비밀번호 안내

Auth 유저는 이전이 되어도 **비밀번호 해시는 REST만으로 복제되지 않을 수 있습니다.**  
이미 새 프로젝트에서 만든 `seoro.park@...` 계정은 그대로 쓰고,
예전 Lovable 전용 계정은 **비밀번호 재설정**이 필요할 수 있습니다.
