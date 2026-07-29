import type { ResonanceFormId, Vec3 } from '@tuner/shared';
import type { FormTuning } from './config.js';

/**
 * Resonance Forms.
 *
 * A form is not a weapon skin. Each one must serve at least two of: combat,
 * movement, platforming, puzzle solving, secret discovery, environmental
 * interaction — and that requirement is asserted in `forms.test.ts`, not just
 * documented here.
 */

export type FormCategory =
  | 'combat'
  | 'movement'
  | 'platforming'
  | 'puzzle'
  | 'secret'
  | 'environment';

export interface FormAbilityDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly categories: readonly FormCategory[];
}

export interface ResonanceFormDef {
  readonly id: ResonanceFormId;
  readonly name: string;
  /** One-line identity used on the form wheel. */
  readonly tagline: string;
  readonly description: string;
  /** Commander whose Frequency Core yielded this form. */
  readonly source: string;
  readonly tuning: FormTuning;
  readonly abilities: readonly FormAbilityDef[];
  /** Silhouette key the renderer uses to reshape the Auralith. */
  readonly silhouette: string;
  /** Icon key for the HUD and form wheel. */
  readonly icon: string;
  /** Sound family key for the audio engine. */
  readonly soundFamily: string;
  readonly upgrades: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly shardCost: number;
  }[];
}

/** Runtime hooks a form may implement. Unimplemented hooks fall back to base. */
export interface FormBehaviour {
  readonly id: ResonanceFormId;
  /** Modifies a freshly-fired projectile. */
  onFire?(context: FormFireContext): void;
  /** Runs each simulation step while the form is equipped. */
  onStep?(context: FormStepContext): void;
  /** Runs when a projectile from this form expires or strikes something. */
  onProjectileEnd?(context: FormProjectileEndContext): void;
  /** Runs when the Harmonic Burst is used with this form equipped. */
  onBurst?(context: FormBurstContext): void;
}

export interface FormFireContext {
  readonly projectileId: number;
  readonly tier: number;
  readonly origin: Vec3;
  readonly direction: Vec3;
  /** Mutates the projectile that was just created. */
  setEchoes(count: number): void;
  setBounces(count: number): void;
  setDamageScale(scale: number): void;
  spawnAdditional(direction: Vec3, damageScale: number): void;
}

export interface FormStepContext {
  readonly deltaSeconds: number;
  readonly playerPosition: Vec3;
  readonly grounded: boolean;
}

export interface FormProjectileEndContext {
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly tier: number;
  readonly hitSomething: boolean;
  spawnEcho(delaySeconds: number): void;
  spawnPlatform(position: Vec3, radius: number, lifeSeconds: number): void;
}

export interface FormBurstContext {
  readonly position: Vec3;
  readonly radius: number;
  rootEnemiesInRadius(seconds: number): void;
  silenceEnemiesInRadius(seconds: number): void;
  restoreCoherence(amount: number): void;
}
