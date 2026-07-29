import { create } from 'zustand';
import type { AudioLevels } from '@tuner/audio';
import type { AccessibilityConfig, StageResult } from '@tuner/game-core';
import type { InputSettings } from '@tuner/input';
import type { DifficultyId, GraphicsTier } from '@tuner/shared';

/**
 * UI and application state.
 *
 * Deliberately holds no gameplay state. The simulation owns the world and the
 * renderer reads it through a ref; putting any of that in here would mean a
 * React re-render every frame, which is the single easiest way to lose the frame
 * budget in a game like this.
 *
 * Navigation is a real stack, so "back" works from every screen rather than
 * every screen having to know where it came from.
 */

export type ScreenId =
  | 'boot'
  | 'title'
  | 'saveSlots'
  | 'settings'
  | 'accessibility'
  | 'credits'
  | 'lattice'
  | 'stageInfo'
  | 'playing'
  | 'results'
  | 'sanctuary'
  | 'codex'
  | 'upgrades'
  | 'composition';

export interface Notification {
  readonly id: number;
  readonly text: string;
  readonly icon?: string;
  readonly expiresAt: number;
}

export interface Subtitle {
  readonly speaker: string;
  readonly text: string;
  readonly expiresAt: number;
}

const MAX_NOTIFICATIONS = 4;

export interface UIState {
  screen: ScreenId;
  /** Screens beneath the current one, oldest first. */
  history: readonly ScreenId[];
  paused: boolean;
  activeSlotId: string | null;

  difficulty: DifficultyId;
  graphicsTier: GraphicsTier;
  audioLevels: AudioLevels;
  inputSettings: Partial<InputSettings>;
  accessibility: Partial<AccessibilityConfig>;

  notifications: readonly Notification[];
  subtitle: Subtitle | null;
  result: StageResult | null;
  /** Objective line shown in the HUD. */
  objective: string;

  navigate(screen: ScreenId): void;
  back(): void;
  replace(screen: ScreenId): void;
  setPaused(paused: boolean): void;
  setActiveSlot(slotId: string | null): void;

  setDifficulty(difficulty: DifficultyId): void;
  setGraphicsTier(tier: GraphicsTier): void;
  setAudioLevel(bus: keyof AudioLevels, value: number): void;
  setInputSetting<K extends keyof InputSettings>(key: K, value: InputSettings[K]): void;
  setAccessibility<K extends keyof AccessibilityConfig>(
    key: K,
    value: AccessibilityConfig[K],
  ): void;

  notify(text: string, seconds?: number, icon?: string): void;
  showSubtitle(speaker: string, text: string, seconds: number): void;
  /** Drops expired notifications and subtitles. `now` is supplied by the host. */
  tick(now: number): void;

  setResult(result: StageResult | null): void;
  setObjective(objective: string): void;
}

let notificationId = 1;

const DEFAULT_LEVELS: AudioLevels = {
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
  ui: 0.7,
  voice: 0.9,
  ambience: 0.5,
};

export const useUIStore = create<UIState>((set, get) => ({
  screen: 'boot',
  history: [],
  paused: false,
  activeSlotId: null,

  difficulty: 'standard',
  graphicsTier: 'high',
  audioLevels: { ...DEFAULT_LEVELS },
  inputSettings: {},
  accessibility: {},

  notifications: [],
  subtitle: null,
  result: null,
  objective: '',

  navigate(screen) {
    const { screen: current, history } = get();
    if (current === screen) return;
    set({ screen, history: [...history, current] });
  },

  back() {
    const { history } = get();
    if (history.length === 0) return; // Back from the root is a safe no-op.
    const previous = history[history.length - 1];
    set({ screen: previous ?? 'title', history: history.slice(0, -1) });
  },

  replace(screen) {
    set({ screen });
  },

  setPaused(paused) {
    set({ paused });
  },

  setActiveSlot(activeSlotId) {
    set({ activeSlotId });
  },

  setDifficulty(difficulty) {
    set({ difficulty });
  },

  setGraphicsTier(graphicsTier) {
    set({ graphicsTier });
  },

  setAudioLevel(bus, value) {
    set({ audioLevels: { ...get().audioLevels, [bus]: Math.max(0, Math.min(1, value)) } });
  },

  setInputSetting(key, value) {
    set({ inputSettings: { ...get().inputSettings, [key]: value } });
  },

  setAccessibility(key, value) {
    set({ accessibility: { ...get().accessibility, [key]: value } });
  },

  notify(text, seconds = 3, icon) {
    const expiresAt = seconds;
    const next: Notification = { id: notificationId++, text, icon, expiresAt };
    // Capped, so a burst of pickups cannot bury the screen.
    const queue = [...get().notifications, next].slice(-MAX_NOTIFICATIONS);
    set({ notifications: queue });
  },

  showSubtitle(speaker, text, seconds) {
    set({ subtitle: { speaker, text, expiresAt: seconds } });
  },

  tick(now) {
    const state = get();
    const notifications = state.notifications.filter((n) => n.expiresAt > now);
    const subtitle = state.subtitle && state.subtitle.expiresAt > now ? state.subtitle : null;
    if (notifications.length !== state.notifications.length || subtitle !== state.subtitle) {
      set({ notifications, subtitle });
    }
  },

  setResult(result) {
    set({ result });
  },

  setObjective(objective) {
    set({ objective });
  },
}));

/** Non-hook accessor, for the host's event wiring. */
export const uiStore = useUIStore;
