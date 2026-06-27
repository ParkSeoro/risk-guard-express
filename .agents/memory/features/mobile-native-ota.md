---
name: Mobile Native & OTA
description: Capacitor 네이티브 앱 + 백그라운드 위치 + Capgo Updater OTA(자체 호스팅) 구조
type: feature
---
- 패키지: `@capacitor-community/background-geolocation`, `@capgo/capacitor-updater`, `@capacitor/push-notifications`, `@capacitor/app`
- `capacitor.config.ts`: 프로덕션 빌드는 `server.url` 미설정(동봉 dist 로드). 개발 시 `CAP_DEV_URL` 환경변수.
- 위치: `src/lib/tracking/locationTracker.ts` 가 네이티브에서는 BackgroundGeolocation 워처 우선, 실패/웹은 기존 navigator/Geolocation fallback.
- OTA: `src/lib/native/otaUpdater.ts` 가 `main.tsx`에서 부팅 시 `get_latest_app_release(channel)` RPC 조회 → 다운로드 → mandatory면 즉시 적용, 아니면 next 부팅 시.
- 채널: localStorage `app-update-channel` (`stable`|`beta`).
- 호스팅: Supabase Storage `app-updates` (public) 버킷. 마스터만 업로드. (버킷은 콘솔에서 생성 필요)
- DB: `app_releases (version, channel, bundle_url, checksum, mandatory, min_native_version, notes)`. 마스터만 INSERT/UPDATE/DELETE.
- 관리 UI: `/settings/mobile-releases` (마스터 전용) — zip 업로드 + SHA-256 자동 계산.
- 가이드 문서: `docs/mobile-build.md` — 권한 plist/manifest, 스토어 배포, OTA 운영 순서.
