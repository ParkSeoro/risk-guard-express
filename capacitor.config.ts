import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.943c0fa50f48402483eac68afc236634',
  appName: 'safenex',
  webDir: 'dist',
  server: {
    url: 'https://943c0fa5-0f48-4024-83ea-c68afc236634.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
  ios: {
    contentInset: 'always',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
