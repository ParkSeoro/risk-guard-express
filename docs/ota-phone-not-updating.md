# 폰에 업데이트가 안 보일 때 (OTA / 재설치)

## 증상
- SafeNex 지웠다 다시 설치해도 화면이 그대로
- 완전 종료 → 재실행해도 새 메뉴(알림 설정, 결재 탭, OTA 카드)가 없음

## 원인 (2026-08-04 확인)
1. **앱이 보는 DB** = `qhntxmggacorqjjmjqgo` (`.env.production`)
2. **CI OTA 게시**가 예전 Lovable 프로젝트(`iqtiozsc…`)로 가고 있었음 → `get_latest_app_release` 가 **빈 배열**
3. Play에 올라간 **마지막 AAB**는 8/3 빌드(versionCode 458)라, 재설치만으로는 최신 UI가 없음

## 지금 한 조치
- 올바른 프로젝트 `app_releases`에 OTA `1.0.0-202608040137` 를 **mandatory=true** 로 등록함
- `main` → `build/android-aab` push 로 **최신 AAB 재빌드** 시작

## 폰에서 (지금 바로)
1. 와이파이 켠 채 SafeNex 실행 (필수 업데이라 받으면 앱이 다시 뜰 수 있음)
2. 안 바뀌면 **최근 앱 화면에서 SafeNex 위로 밀어 종료** → 다시 실행
3. 더보기 맨 위 **「앱 화면 업데이트 (OTA)」** / 알림·알람 설정 확인

## 당신이 GitHub에서 고쳐야 할 것 (다음 CI부터)
레포 **Settings → Secrets and variables → Actions**

| Secret | 올바른 값 |
|--------|-----------|
| `OTA_PUBLISH_URL` | `https://qhntxmggacorqjjmjqgo.supabase.co/functions/v1/publish-ota-release` |
| `OTA_PUBLISH_TOKEN` | 같은 프로젝트 Edge Function Secret `OTA_PUBLISH_TOKEN` |

Edge Function `publish-ota-release` 가 해당 프로젝트에 배포돼 있어야 합니다.

## AAB (재설치로 확실히 맞추기)
1. Actions → **Android AAB** 최신 run 완료 대기
2. Artifacts 에서 `safenex-1.0.0-*.aab` 다운로드
3. Play Console 내부 테스트에 업로드 → 테스터로 업데이트/재설치
