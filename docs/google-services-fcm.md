# Android native assets (FCM)

패키지: `org.safenex.app`  
Firebase 프로젝트: `safenex-71fe9`

## 1. `google-services.json` (AAB 클라이언트 — **필수**)

앱이 FCM **수신**에 필요합니다. AAB 워크플로는 없으면 실패합니다.

- 커밋 경로: `native-assets/fcm/google-services.json`
- 또는 GitHub Secret `GOOGLE_SERVICES_JSON_BASE64`

---

## 2. Edge 서버 발송 (Admin SDK — **권장**)

클라이언트가 토큰을 받아도, Edge `dispatch-notification-push` 가 보내야 트레이에 뜹니다.

다운로드한 `…-firebase-adminsdk-….json` 전체(= `"type": "service_account"`)를 씁니다.  
**레포에 커밋하지 마세요.** Supabase Secret 에만 넣습니다.

### Dashboard 등록 (가장 쉬움)

1. [Supabase Dashboard](https://supabase.com/dashboard) → 사용 중 프로젝트
2. **Project Settings** → **Edge Functions** → **Secrets**
3. **Add new secret**
   - **Name:** `FIREBASE_SERVICE_ACCOUNT_JSON`
   - **Value:** Admin SDK JSON **전체** (중괄호 `{` … `}` 포함, 한 줄이어도 됨)
4. 저장 후 Edge Function `dispatch-notification-push` **Redeploy** (Secrets만 바꿔도 보통 즉시 반영되지만, 안 되면 Redeploy)

### CLI

```bash
supabase link --project-ref qhntxmggacorqjjmjqgo
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat safenex-71fe9-firebase-adminsdk-….json)"
```

### 확인

- Function 로그에 `native_mode: "http_v1"`, `native.sent >= 1`
- `device_push_tokens` 에 android 토큰 존재
- 알림 발생 시 기기 트레이 수신

---

## 3. (구형) `FCM_SERVER_KEY` — 선택 폴백

Legacy Cloud Messaging 서버 키(`AAAA…`)입니다.  
`FIREBASE_SERVICE_ACCOUNT_JSON` 이 있으면 **무시해도 됩니다.**

---

VAPID(`VAPID_*`)는 **웹 푸시**용이며 네이티브 FCM을 대체하지 않습니다.
