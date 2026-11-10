import type { EventBus, GameEvents, Settings, SettingsStore } from './api';

const KEY = 'aurelion.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  quality: 'auto',
  dynamicResolution: true,
  showFps: false,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  mouseSensitivity: 1,
  gamepadSensitivity: 1,
  invertY: false,
  difficulty: 'standard',
  aimAssist: true,
  subtitles: true,
  subtitleSize: 'm',
  subtitleBackground: true,
  captions: true,
  reduceFlash: false,
  reduceShake: false,
  reduceDistortion: false,
  holdToToggle: false,
  autoPrompts: false,
  navAssist: true,
};

/** Persistent settings (localStorage, guarded — storage can throw in sandboxed frames). */
export class SettingsStoreImpl implements SettingsStore {
  private v: Settings = { ...DEFAULT_SETTINGS };

  constructor(private events: EventBus<GameEvents>) {
    try {
      const raw = globalThis.localStorage?.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Settings>;
        for (const k of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
          if (k in parsed && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) (this.v as any)[k] = parsed[k];
        }
      }
    } catch {
      /* storage unavailable: run with defaults */
    }
  }

  get values(): Readonly<Settings> {
    return this.v;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.v[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.v[key] === value) return;
    this.v[key] = value;
    this.persist();
    this.events.emit('settings:changed', { key });
  }

  reset(): void {
    this.v = { ...DEFAULT_SETTINGS };
    this.persist();
    for (const k of Object.keys(DEFAULT_SETTINGS)) this.events.emit('settings:changed', { key: k });
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(this.v));
    } catch {
      /* ignore */
    }
  }
}
