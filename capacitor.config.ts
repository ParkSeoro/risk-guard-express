import type { CapacitorConfig } from '@capacitor/cli';

// 프로덕션 네이티브 빌드: server.url 을 비워두면 동봉된 dist/ 가 로드되어 OTA 갱신이 가능합니다.
// 개발 중 핫리로드를 쓰려면 CAP_DEV_URL 환경변수를 설정해 빌드하세요.
const devUrl = process.env.CAP_DEV_URL;

const config: CapacitorConfig = {
  appId: 'org.safenex.app',
  appName: 'Safenex',
  // Vite 빌드 산출물 — OTA(@capgo/capacitor-updater)도 이 경로 기준
  webDir: 'dist',
  ...(devUrl
    ? { server: { url: devUrl, cleartext: true } }
    : { server: { androidScheme: 'https' } }),

  // 백그라운드 위치 추적이 약 5분 후 멈추는 Capacitor 브리지 이슈 방지
  // @see https://github.com/capacitor-community/background-geolocation/issues/89
  android: {
    useLegacyBridge: true,
  },

  plugins: {
    // 화면 꺼짐/백그라운드에서 WebView fetch 가 스로틀되는 것을 우회
    // supabase.functions.invoke → fetch 가 네이티브 HTTP 로 라우팅됨
    CapacitorHttp: {
      enabled: true,
    },

    Geolocation: {
      // iOS: Always-Allow 권한을 요청해 잠금/백그라운드에서도 위치 추적
      permissions: ['location'],
    },

    // @capacitor-community/background-geolocation
    // 실제 알림 채널명은 android/.../strings.xml 의
    // capacitor_background_geolocation_notification_channel_name 으로 설정.
    // 런타임 옵션(backgroundMessage/Title)은 locationTracker.ts 에서 전달.
    BackgroundGeolocation: {
      notificationChannelName: '위치 추적',
    },

    // @capgo/capacitor-updater — OTA 는 initOtaUpdater()에서 수동 제어
    CapacitorUpdater: {
      autoUpdate: false,
      // notifyAppReady() 미호출 시 이 시간 후 이전 번들로 롤백
      appReadyTimeout: 10_000,
      responseTimeout: 20,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      resetWhenUpdate: true,
    },

    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
