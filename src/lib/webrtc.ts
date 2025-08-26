import { Capacitor } from '@capacitor/core';

interface IOSRTCPlugin {
  registerGlobals: () => void;
  debug?: { enable?: (namespace: string) => void };
}

interface CordovaPlugins {
  iosrtc?: IOSRTCPlugin;
}

interface CordovaGlobal {
  plugins?: CordovaPlugins;
}

declare global {
  interface Window {
    cordova?: CordovaGlobal;
  }
}

let initialized = false;

export function ensureWebRTCGlobals() {
  if (initialized) return;
  initialized = true;

  if (Capacitor.getPlatform() === 'ios') {
    const register = () => {
      const iosrtc = window.cordova?.plugins?.iosrtc;
      if (iosrtc && typeof iosrtc.registerGlobals === 'function') {
        iosrtc.registerGlobals();
        if (iosrtc.debug?.enable) {
          iosrtc.debug.enable('*');
        }
      }
    };

    if (window.cordova) {
      document.addEventListener('deviceready', register, { once: true });
    } else {
      register();
    }
  }
}
