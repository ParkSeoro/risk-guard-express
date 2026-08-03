# Android native assets (FCM)

패키지: `org.safenex.app`  
Firebase 프로젝트: `safenex-71fe9`

## 1. `google-services.json` (AAB 클라이언트 — **필수**)

Play 앱이 FCM 토큰을 받으려면 필요합니다. AAB 워크플로는 없으면 **실패**합니다.

### 넣는 방법 (택 1)

**A. GitHub Secret (공개 레포 권장)**  
```bash
base64 -w0 google-services.json   # macOS: base64 -i google-services.json
```
레포 **Settings → Secrets → Actions** → `GOOGLE_SERVICES_JSON_BASE64`

**B. 이 폴더에 파일 커밋**  
`native-assets/fcm/google-services.json` (현재 방식). CI가 `android/app/` 으로 복사합니다.

---

## 2. Edge `FCM_SERVER_KEY` (서버 발송 — **필수**, 직접 설정)

`google-services.json` 안의 `api_key`(AIza…)는 **앱 클라이언트용**입니다.  
서버가 푸시를 **보내는** 키와 다릅니다. Edge Function `dispatch-notification-push` 는 레거시 HTTP API를 쓰므로 **Server key** 가 필요합니다.

### 2-1. Firebase에서 서버 키 복사

1. [Firebase Console](https://console.firebase.google.com/) → 프로젝트 **`safenex-71fe9`**
2. 왼쪽 톱니바퀴 **프로젝트 설정** → 상단 탭 **Cloud Messaging**
3. **Cloud Messaging API (Legacy)** 섹션의 **서버 키** 복사  
   - 키가 안 보이거나 “API 사용 중지됨”이면:
     - [Google Cloud Console → API 라이브러리](https://console.cloud.google.com/apis/library/fcm.googleapis.com?project=safenex-71fe9) 에서  
       **Firebase Cloud Messaging API** 사용 설정  
     - 또는 Cloud Messaging 탭에서 Legacy API **사용 설정** 후 새로고침
4. 서버 키는 보통 `AAAA…` 로 시작하는 긴 문자열입니다. (`AIza…` 클라이언트 키 아님)

### 2-2. Supabase Edge Secret에 등록 (택 1)

**방법 A — Dashboard (가장 쉬움)**  
1. [Supabase Dashboard](https://supabase.com/dashboard) → 프로젝트 (`qhntxmggacorqjjmjqgo` 등 사용 중 프로젝트)
2. **Project Settings** → **Edge Functions** → **Secrets**
3. **Add new secret**
   - Name: `FCM_SERVER_KEY`
   - Value: (위에서 복사한 서버 키 전체)
4. 저장. 이미 배포된 `dispatch-notification-push` 는 다음 호출부터 새 secret을 읽습니다.  
   (안 되면 Functions → `dispatch-notification-push` **Redeploy** 한 번)

**방법 B — CLI**  
로컬에 [Supabase CLI](https://supabase.com/docs/guides/cli) 로그인 후:

```bash
supabase link --project-ref qhntxmggacorqjjmjqgo
supabase secrets set FCM_SERVER_KEY="여기에_서버_키_붙여넣기"
supabase secrets list   # FCM_SERVER_KEY 있는지 확인 (값은 마스킹됨)
```

### 2-3. 동작 확인

1. 앱 설치 → 알림 권한 허용 → 로그인
2. DB `device_push_tokens` 에 `platform=android` 행이 생기는지 확인
3. 알림/위험구역 이벤트 발생 시 트레이 푸시 수신
4. Edge 로그: Dashboard → Edge Functions → `dispatch-notification-push` → Logs  
   `native.sent >= 1` 이면 OK. `FCM_SERVER_KEY` 없으면 native 분기가 건너뛰어집니다.

---

VAPID 키(`VAPID_*`)는 **웹 푸시**용이며 네이티브 FCM을 대체하지 않습니다.
