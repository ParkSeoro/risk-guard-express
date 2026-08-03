# Android native assets (FCM)

패키지: `org.safenex.app`  
Firebase 프로젝트: `safenex-71fe9`

## 1. `google-services.json` (AAB 클라이언트 — **필수**)

앱이 FCM **수신**에 필요합니다. AAB 워크플로는 없으면 실패합니다.

- 커밋 경로: `native-assets/fcm/google-services.json`
- 또는 GitHub Secret `GOOGLE_SERVICES_JSON_BASE64`

---

## 2. Edge 서버 발송 (Admin SDK — **권장**)

Secret Name: `FIREBASE_SERVICE_ACCOUNT_JSON`  
Value: Admin SDK JSON 전체 (`type: service_account`)

추가로 DB 트리거 인증용:

- Edge Secret: `PUSH_TRIGGER_SECRET`  
  (= `private.dispatch_config.trigger_secret` 와 동일)

---

## 3. DB `private.dispatch_config` (푸시 트리거 URL)

알림 INSERT → pg_net → Edge. URL이 틀리면 푸시가 나가지 않습니다.

Supabase **SQL Editor**에서 확인/수정:

```sql
SELECT key, value FROM private.dispatch_config;

UPDATE private.dispatch_config
SET value = 'https://qhntxmggacorqjjmjqgo.supabase.co'
WHERE key = 'supabase_url';
```

마이그레이션 `20260803123000_fix_dispatch_config_url.sql` 도 동일 내용을 적용합니다.

---

## 4. (구형) `FCM_SERVER_KEY` — 선택 폴백

`FIREBASE_SERVICE_ACCOUNT_JSON` 이 있으면 불필요합니다.

VAPID(`VAPID_*`)는 **웹 푸시**용이며 네이티브 FCM을 대체하지 않습니다.
