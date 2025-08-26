import { Capacitor } from '@capacitor/core';

interface IOSRTCPlugin {
  registerGlobals: () => void;
  observeVideo?: (element: HTMLVideoElement) => void;
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

    // Register immediately in case the plugin is already loaded and
    // again on deviceready so native globals are available once Cordova
    // finishes bootstrapping.
    document.addEventListener('deviceready', register, { once: true });
    register();
  }
}

export function observeVideo(element: HTMLVideoElement) {
  if (Capacitor.getPlatform() === 'ios') {
    const iosrtc = window.cordova?.plugins?.iosrtc;
    if (iosrtc && typeof iosrtc.observeVideo === 'function') {
      iosrtc.observeVideo(element);
    }
  }
}
