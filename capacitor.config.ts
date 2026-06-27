import type { CapacitorConfig } from '@capacitor/cli';

// 프로덕션 네이티브 빌드: server.url 을 비워두면 동봉된 dist/ 가 로드되어 OTA 갱신이 가능합니다.
// 개발 중 핫리로드를 쓰려면 CAP_DEV_URL 환경변수를 설정해 빌드하세요.
const devUrl = process.env.CAP_DEV_URL;

const config: CapacitorConfig = {
  appId: 'app.lovable.943c0fa50f48402483eac68afc236634',
  appName: 'safenex',
  webDir: 'dist',
  ...(devUrl
    ? { server: { url: devUrl, cleartext: true } }
    : { server: { androidScheme: 'https' } }),
  plugins: {
    Geolocation: {
      // iOS: Always-Allow 권한을 요청해 잠금/백그라운드에서도 위치 추적
      permissions: ['location'],
    },
    BackgroundGeolocation: {
      // Android 알림 채널 ID
      notificationChannelName: '위치 추적',
    },
    CapacitorUpdater: {
      // OTA 자동 시작 끄고, 우리 코드(`initOtaUpdater`)에서 통제
      autoUpdate: false,
      // 새 번들이 안정적이지 않으면 5초 후 이전 번들로 롤백
      appReadyTimeout: 5000,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
