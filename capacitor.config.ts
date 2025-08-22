import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zoya.babymonitor',
  appName: 'Zoya',
  webDir: 'dist',
  server: {
    url: 'https://9d08e8a4-4925-4c2d-8401-9831f2337875.lovableproject.com?forceHideBadge=true',
    cleartext: true
  },
  plugins: {
    Camera: {
      permissions: ['camera', 'microphone']
    },
    Haptics: {}
  }
};

export default config;