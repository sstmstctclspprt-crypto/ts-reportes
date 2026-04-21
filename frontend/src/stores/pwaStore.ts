import { defineStore } from 'pinia';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstallable: boolean;
  isStandalone: boolean;
}

function detectStandalone(): boolean {
  const mediaStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaStandalone || iosStandalone;
}

export const usePwaStore = defineStore('pwa', {
  state: (): PwaState => ({
    deferredPrompt: null,
    isInstallable: false,
    isStandalone: detectStandalone()
  }),
  actions: {
    init() {
      window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        this.deferredPrompt = event as BeforeInstallPromptEvent;
        this.isInstallable = true;
      });

      window.addEventListener('appinstalled', () => {
        this.deferredPrompt = null;
        this.isInstallable = false;
        this.isStandalone = true;
      });
    },
    async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
      if (!this.deferredPrompt) return 'unavailable';

      const promptEvent = this.deferredPrompt;
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;

      this.deferredPrompt = null;
      this.isInstallable = false;
      this.isStandalone = detectStandalone();
      return choice.outcome;
    }
  }
});
