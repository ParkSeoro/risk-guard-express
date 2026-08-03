# Android native assets (committed)

## `google-services.json` (FCM)

Play 푸시에 필요합니다. 패키지 `org.safenex.app`.

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

AAB 워크플로는 둘 중 하나가 없으면 **실패**합니다.
