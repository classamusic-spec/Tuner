import {
  DEFAULT_AUDIO_LEVELS_SNAPSHOT,
  type DifficultyId,
  type GraphicsTier,
  type Rank,
  type ResonanceFormId,
  type StageId,
} from './constants.js';
import type { StageResult } from '@tuner/game-core';

/**
 * `@tuner/persistence` — versioned saves and the adapters that store them.
 *
 * Two rules shape this module:
 *
 * 1. **Never trust stored data.** `validateSave` is genuinely defensive, because
 *    a save file is the one input a player can corrupt by accident — a full
 *    disk, a closed tab mid-write, a browser clearing storage. Rejecting a bad
 *    slot is recoverable; loading it and crashing on the third stage is not.
 * 2. **A corrupt slot must not take the others with it.** Slots are read and
 *    parsed independently, so one bad record cannot make a player lose a save
 *    they still have.
 */

export const CURRENT_SAVE_VERSION = 1;

export interface StageRecord {
  readonly completed: boolean;
  readonly bestRank: Rank | null;
  readonly bestTimeSeconds: number | null;
  readonly secretsFound: readonly string[];
  readonly collectiblesFound: readonly string[];
}

export interface CollectibleTotals {
  resonanceShards: number;
  coherenceFragments: number;
  frequencyCapacitors: number;
  lostMotifs: readonly string[];
  keeperMemories: readonly string[];
  geometryTablets: readonly string[];
  signalSamples: readonly string[];
  sanctuarySeeds: number;
}

export interface SaveSettings {
  audioLevels: Record<string, number>;
  inputSettings: Record<string, unknown>;
  accessibility: Record<string, unknown>;
  graphicsTier: GraphicsTier;
}

export interface SaveData {
  version: number;
  slotName: string;
  /** Supplied by the caller — nothing in here reads the clock itself. */
  lastPlayedISO: string;
  totalPlaySeconds: number;
  completionPercent: number;
  difficulty: DifficultyId;
  unlockedForms: readonly ResonanceFormId[];
  stages: Partial<Record<StageId, StageRecord>>;
  collectibles: CollectibleTotals;
  purchasedUpgrades: readonly string[];
  maxCoherenceBonus: number;
  sanctuaryRestored: readonly string[];
  settings: SaveSettings;
  codexDiscovered: readonly string[];
  bestiaryDiscovered: readonly string[];
  activeStage: StageId | null;
  activeCheckpointId: string | null;
}

export function createEmptySave(slotName: string, nowISO: string): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    slotName,
    lastPlayedISO: nowISO,
    totalPlaySeconds: 0,
    completionPercent: 0,
    difficulty: 'standard',
    unlockedForms: ['base'],
    stages: {},
    collectibles: {
      resonanceShards: 0,
      coherenceFragments: 0,
      frequencyCapacitors: 0,
      lostMotifs: [],
      keeperMemories: [],
      geometryTablets: [],
      signalSamples: [],
      sanctuarySeeds: 0,
    },
    purchasedUpgrades: [],
    maxCoherenceBonus: 0,
    sanctuaryRestored: [],
    settings: {
      audioLevels: { ...DEFAULT_AUDIO_LEVELS_SNAPSHOT },
      inputSettings: {},
      accessibility: {},
      graphicsTier: 'high',
    },
    codexDiscovered: [],
    bestiaryDiscovered: [],
    activeStage: null,
    activeCheckpointId: null,
  };
}

export type ValidationResult =
  | { readonly ok: true; readonly save: SaveData }
  | { readonly ok: false; readonly errors: readonly string[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Defensive on purpose. A rejected slot is recoverable; a trusted bad one is not. */
export function validateSave(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (data === null || data === undefined) {
    return { ok: false, errors: ['save is null or undefined'] };
  }
  if (!isRecord(data)) {
    return { ok: false, errors: [`save is not an object (got ${typeof data})`] };
  }
  if (typeof data.version !== 'number' || !Number.isFinite(data.version)) {
    errors.push('missing or non-numeric "version"');
  }
  if (typeof data.slotName !== 'string' || data.slotName.length === 0) {
    errors.push('missing or empty "slotName"');
  }
  if (typeof data.totalPlaySeconds !== 'number' || data.totalPlaySeconds < 0) {
    errors.push('"totalPlaySeconds" must be a non-negative number');
  }
  if (!Array.isArray(data.unlockedForms)) {
    errors.push('"unlockedForms" must be an array');
  }
  if (data.stages !== undefined && !isRecord(data.stages)) {
    errors.push('"stages" must be an object');
  } else if (isRecord(data.stages)) {
    for (const [stageId, record] of Object.entries(data.stages)) {
      if (!isRecord(record)) {
        errors.push(`stage "${stageId}" record is not an object`);
        continue;
      }
      if (typeof record.completed !== 'boolean') {
        errors.push(`stage "${stageId}" is missing "completed"`);
      }
      if (!Array.isArray(record.secretsFound)) {
        errors.push(`stage "${stageId}" is missing "secretsFound"`);
      }
    }
  }
  if (data.collectibles !== undefined && !isRecord(data.collectibles)) {
    errors.push('"collectibles" must be an object');
  }
  if (data.settings !== undefined && !isRecord(data.settings)) {
    errors.push('"settings" must be an object');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, save: data as unknown as SaveData };
}

/**
 * Migration chain. Only version 1 exists so far, but the structure is here so
 * the first real migration is a small change rather than a redesign.
 */
export function migrateSave(data: unknown): ValidationResult {
  if (!isRecord(data)) return validateSave(data);
  let working: Record<string, unknown> = { ...data };

  const version = typeof working.version === 'number' ? working.version : 0;
  if (version > CURRENT_SAVE_VERSION) {
    return {
      ok: false,
      errors: [`save version ${version} is newer than this build supports (${CURRENT_SAVE_VERSION})`],
    };
  }
  if (version < 1) {
    // Pre-versioned data: fill in the fields v1 requires and mark it.
    working = { ...createEmptySave(String(working.slotName ?? 'Recovered'), ''), ...working };
    working.version = 1;
  }

  return validateSave(working);
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

export function createMemoryStorageAdapter(): StorageAdapter {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    remove: async (key) => {
      store.delete(key);
    },
    keys: async () => Array.from(store.keys()),
  };
}

export function createNoopStorageAdapter(): StorageAdapter {
  return {
    get: async () => null,
    set: async () => false,
    remove: async () => {},
    keys: async () => [],
  };
}

/** Falls back to memory when localStorage is missing or blocked. */
export function createLocalStorageAdapter(prefix = 'tuner:'): StorageAdapter {
  const available = ((): boolean => {
    try {
      if (typeof localStorage === 'undefined') return false;
      const probe = `${prefix}__probe`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return true;
    } catch {
      return false;
    }
  })();

  if (!available) return createMemoryStorageAdapter();

  return {
    get: async (key) => {
      try {
        return localStorage.getItem(prefix + key);
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      try {
        localStorage.setItem(prefix + key, value);
        return true;
      } catch {
        // A full quota must report failure, never throw into the game loop.
        return false;
      }
    },
    remove: async (key) => {
      try {
        localStorage.removeItem(prefix + key);
      } catch {
        /* nothing useful to do */
      }
    },
    keys: async () => {
      try {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) out.push(key.slice(prefix.length));
        }
        return out;
      } catch {
        return [];
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Save system
// ---------------------------------------------------------------------------

export interface SlotSummary {
  readonly id: string;
  readonly name: string;
  readonly totalPlaySeconds: number;
  readonly completionPercent: number;
  readonly lastPlayedISO: string;
  /** True when the slot exists but could not be parsed. */
  readonly corrupt: boolean;
}

export interface SaveSystem {
  save(slotId: string, data: SaveData): Promise<boolean>;
  load(slotId: string): Promise<ValidationResult>;
  remove(slotId: string): Promise<void>;
  list(): Promise<readonly SlotSummary[]>;
  /** Debounced write, for autosaving without hammering storage. */
  autosave(slotId: string, data: SaveData): void;
  flush(): Promise<void>;
  exportSave(data: SaveData): string;
  importSave(json: string): ValidationResult;
}

export function createSaveSystem(
  adapter: StorageAdapter,
  options?: { readonly autosaveDelayMs?: number; readonly schedule?: (fn: () => void, ms: number) => void },
): SaveSystem {
  const delay = options?.autosaveDelayMs ?? 1200;
  const schedule =
    options?.schedule ??
    ((fn: () => void, ms: number) => {
      if (typeof setTimeout === 'function') setTimeout(fn, ms);
      else fn();
    });

  let pending: { slotId: string; data: SaveData } | null = null;
  let scheduled = false;

  const writeNow = async (): Promise<void> => {
    const job = pending;
    pending = null;
    scheduled = false;
    if (!job) return;
    await adapter.set(`slot:${job.slotId}`, JSON.stringify(job.data));
  };

  return {
    async save(slotId, data) {
      return adapter.set(`slot:${slotId}`, JSON.stringify(data));
    },

    async load(slotId) {
      const raw = await adapter.get(`slot:${slotId}`);
      if (raw === null) return { ok: false, errors: [`slot "${slotId}" is empty`] };
      try {
        return migrateSave(JSON.parse(raw));
      } catch (error) {
        return {
          ok: false,
          errors: [`slot "${slotId}" is not valid JSON: ${String(error)}`],
        };
      }
    },

    async remove(slotId) {
      await adapter.remove(`slot:${slotId}`);
    },

    async list() {
      const keys = await adapter.keys();
      const out: SlotSummary[] = [];
      for (const key of keys) {
        if (!key.startsWith('slot:')) continue;
        const id = key.slice('slot:'.length);
        const raw = await adapter.get(key);
        if (raw === null) continue;
        // Each slot is parsed independently: one corrupt record must never stop
        // the others from being listed or loaded.
        try {
          const result = migrateSave(JSON.parse(raw));
          if (result.ok) {
            out.push({
              id,
              name: result.save.slotName,
              totalPlaySeconds: result.save.totalPlaySeconds,
              completionPercent: result.save.completionPercent,
              lastPlayedISO: result.save.lastPlayedISO,
              corrupt: false,
            });
          } else {
            out.push({
              id,
              name: id,
              totalPlaySeconds: 0,
              completionPercent: 0,
              lastPlayedISO: '',
              corrupt: true,
            });
          }
        } catch {
          out.push({
            id,
            name: id,
            totalPlaySeconds: 0,
            completionPercent: 0,
            lastPlayedISO: '',
            corrupt: true,
          });
        }
      }
      return out;
    },

    autosave(slotId, data) {
      pending = { slotId, data };
      if (scheduled) return;
      scheduled = true;
      schedule(() => void writeNow(), delay);
    },

    async flush() {
      await writeNow();
    },

    exportSave(data) {
      return JSON.stringify(data, null, 2);
    },

    importSave(json) {
      try {
        return migrateSave(JSON.parse(json));
      } catch (error) {
        return { ok: false, errors: [`not valid JSON: ${String(error)}`] };
      }
    },
  };
}

const RANK_ORDER: readonly Rank[] = ['D', 'C', 'B', 'A', 'S'];

/**
 * Folds a stage result into a save, keeping the *best* of everything.
 *
 * A player who replays a stage for fun and does worse must not lose their S
 * rank, so rank and time are merged rather than overwritten, and found secrets
 * accumulate across every visit.
 */
export function applyStageResult(save: SaveData, result: StageResult): SaveData {
  const existing = save.stages[result.stageId];

  const bestRank = ((): Rank => {
    if (!existing?.bestRank) return result.rank;
    return RANK_ORDER.indexOf(result.rank) > RANK_ORDER.indexOf(existing.bestRank)
      ? result.rank
      : existing.bestRank;
  })();

  const bestTime = ((): number => {
    const candidate = result.metrics.elapsedSeconds;
    if (existing?.bestTimeSeconds == null) return candidate;
    return Math.min(existing.bestTimeSeconds, candidate);
  })();

  const secrets = new Set([...(existing?.secretsFound ?? []), ...(result.metrics.formsUsed.length ? [] : [])]);
  for (const id of existing?.secretsFound ?? []) secrets.add(id);

  return {
    ...save,
    unlockedForms: result.formAwarded
      ? Array.from(new Set([...save.unlockedForms, result.formAwarded]))
      : save.unlockedForms,
    stages: {
      ...save.stages,
      [result.stageId]: {
        completed: existing?.completed === true || result.completed,
        bestRank,
        bestTimeSeconds: bestTime,
        secretsFound: Array.from(secrets),
        collectiblesFound: existing?.collectiblesFound ?? [],
      },
    },
  };
}

/** Records secrets discovered this run into the save. */
export function recordSecrets(
  save: SaveData,
  stageId: StageId,
  secretIds: readonly string[],
): SaveData {
  const existing = save.stages[stageId];
  const merged = new Set([...(existing?.secretsFound ?? []), ...secretIds]);
  return {
    ...save,
    stages: {
      ...save.stages,
      [stageId]: {
        completed: existing?.completed ?? false,
        bestRank: existing?.bestRank ?? null,
        bestTimeSeconds: existing?.bestTimeSeconds ?? null,
        secretsFound: Array.from(merged),
        collectiblesFound: existing?.collectiblesFound ?? [],
      },
    },
  };
}
