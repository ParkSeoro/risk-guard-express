# 결재 푸시가 안 올 때 (진단 SSOT)

## 파이프라인
```
결재 진행중 → notifications(approval_request)
            → pg_net → dispatch-notification-push
            → FCM → 폰 (채널 safenex_default, 사이렌 아님)
```

위험구역 사이렌은 **폰 로컬 TTS**일 수 있어, 그것만으로 FCM이 정상인지 판단하면 안 됩니다.

## 2026-08-04 운영에서 확인된 것
1. **`dispatch-notification-push` Enforce JWT = ON** 이었음  
   → 트리거는 Secret만 보내서 게이트웨이 401 → **푸시 전멸**  
   → **verify_jwt=false 로 해제 완료** (재발 방지: `supabase/config.toml`)
2. `private.dispatch_config.supabase_url` = `qhntxmgg…` OK  
3. FCM HTTP v1 동작 확인 (`native_mode: http_v1`, 토큰 있는 유저로 sent>0)
4. **최근 결재 수신자 대부분 `device_push_tokens` 없음**  
   → 알림 행은 생기지만 **보낼 폰이 등록 안 됨**

## 결재자 폰에서 (계정마다)
1. **그 결재자 계정으로** SafeNex 로그인
2. 더보기 → **알림 · 알람 설정** → 푸시 권한 허용
3. FCM 토큰이 보이면 → **테스트** 눌러 상단 배너 확인
4. 테스트 성공 후 실제 결재 상신

토큰이 없는 계정으로는 절대 폰 푸시가 가지 않습니다. (앱 안 알림함 ≠ 폰 상단 푸시)

## 마스터/서버 체크
| 항목 | 기대 |
|------|------|
| Edge `dispatch-notification-push` Enforce JWT | **OFF** |
| Edge `PUSH_TRIGGER_SECRET` | DB `private.dispatch_config.trigger_secret` 과 동일 |
| Edge `FIREBASE_SERVICE_ACCOUNT_JSON` | 설정됨 |
| `dispatch_config.supabase_url` | `https://qhntxmggacorqjjmjqgo.supabase.co` |
| `device_push_tokens` for approver `user_id` | ≥1행 |

## 채널
결재는 **일반 알림** (`safenex_default`). 사이렌 채널이 아닙니다.
