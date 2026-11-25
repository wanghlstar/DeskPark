import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.example.deskpark',
  appName: '闲亭',
  webDir: 'dist',
  android: { allowMixedContent: true },
  server: { androidScheme: 'https', cleartext: true },
};

export default config;
