# Android native assets (FCM)

패키지: `org.safenex.app`

## 1. `google-services.json` (AAB 클라이언트 — **필수**)

Play 푸시 수신에 필요합니다. AAB 워크플로는 없으면 **실패**합니다.

### 넣는 방법 (택 1)

**A. GitHub Secret (권장)**  
Firebase Console → 프로젝트 설정 → Android 앱 `org.safenex.app` → `google-services.json` 다운로드 후:

```bash
base64 -w0 google-services.json   # macOS: base64 -i google-services.json
```

레포 **Settings → Secrets → Actions** 에  
`GOOGLE_SERVICES_JSON_BASE64` = 위 결과 전체

**B. 이 폴더에 파일 커밋**  
`native-assets/fcm/google-services.json` 으로 저장 (CI가 복사).  
공개 레포면 Secret 방식을 쓰세요.

## 2. Edge `FCM_SERVER_KEY` (서버 발송 — **필수**)

클라이언트가 토큰을 받아도, Supabase Edge `dispatch-notification-push` 에  
Firebase **Cloud Messaging API (레거시) 서버 키**가 없으면 네이티브 트레이 푸시가 나가지 않습니다.

```bash
supabase secrets set FCM_SERVER_KEY="<Firebase Cloud Messaging 서버 키>"
```

Firebase Console → 프로젝트 설정 → Cloud Messaging → **Cloud Messaging API (Legacy)** 서버 키.

VAPID 키는 웹 푸시용이며 네이티브 FCM을 대체하지 않습니다.
