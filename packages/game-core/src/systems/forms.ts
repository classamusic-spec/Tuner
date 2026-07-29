import { clamp, type ResonanceFormId } from '@tuner/shared';
import type { System } from '../internal/context.js';
import type { FormBehaviour } from '../forms.js';
import { FORM_WHEEL_ORDER, RESONANCE_FORMS } from './forms-registry.js';

/**
 * Form switching and per-form behaviour.
 *
 * Two rules shape this file.
 *
 * **Switching is instant.** No cooldown, no animation lock, no commitment
 * window. A system that punishes experimentation does not get experimented
 * with, and the whole point of eight forms is that the player reaches for a
 * different one when the first answer does not work.
 *
 * **Forms attach only through hooks.** A form may modify a shot it just fired,
 * run a passive effect, react when one of its shots ends, or react to a
 * Harmonic Burst. It cannot reach anywhere else. That constraint is what keeps
 * eight sets of special behaviour from turning the combat system into a switch
 * statement.
 */

/** Seconds of Bloom regrowth per second, while grounded and unharmed. */
const BLOOM_REGEN_PER_SECOND = 3.2;

/** Radius within which Silence Form suppresses enemy attacks. */
const SILENCE_FIELD_RADIUS = 9;
const SILENCE_REFRESH_SECONDS = 0.25;

/** How long Bloom's roots and Silence's muting last when applied by a burst. */
const BLOOM_ROOT_SECONDS = 2.4;
const SILENCE_BURST_SECONDS = 3;

export function formCount(): number {
  return FORM_WHEEL_ORDER.length;
}

/** Resolves a wheel index to a form id, wrapping rather than clamping. */
export function formAtIndex(index: number): ResonanceFormId {
  const count = FORM_WHEEL_ORDER.length;
  const wrapped = ((index % count) + count) % count;
  return FORM_WHEEL_ORDER[wrapped] ?? 'base';
}

/** Wheel position of a form, or 0 if somehow unknown. */
export function indexOfForm(form: ResonanceFormId): number {
  const index = FORM_WHEEL_ORDER.indexOf(form);
  return index < 0 ? 0 : index;
}

/**
 * Steps through the *unlocked* forms only.
 *
 * Cycling onto a form the player has not earned would be worse than useless —
 * it would put a dead slot between them and the form they wanted, mid-fight.
 */
export function nextUnlockedForm(
  current: ResonanceFormId,
  unlocked: readonly ResonanceFormId[],
  direction: 1 | -1,
): ResonanceFormId {
  const owned = FORM_WHEEL_ORDER.filter((id) => unlocked.includes(id));
  if (owned.length === 0) return 'base';
  const at = owned.indexOf(current);
  if (at < 0) return owned[0] ?? 'base';
  const next = (at + direction + owned.length) % owned.length;
  return owned[next] ?? current;
}

// ---------------------------------------------------------------------------
// The system
// ---------------------------------------------------------------------------

export const formSystem: System = (ctx): void => {
  const { world } = ctx;
  const player = world.player;

  if (!world.paused && player.movementState !== 'downed') {
    resolveSwitch(ctx);
  }

  // Passive per-form effects. These run every step regardless of input.
  applyPassives(ctx);

  // Record whatever is equipped, so the results screen can score ability
  // variety honestly rather than only counting deliberate switches.
  world.stage.formsUsed.add(player.form);
};

function resolveSwitch(ctx: Parameters<System>[0]): void {
  const { world, input, events } = ctx;
  const player = world.player;

  let requested: ResonanceFormId | null = null;

  if (input.requestedFormIndex !== null) {
    const candidate = formAtIndex(input.requestedFormIndex);
    // A number key for a form you have not earned should do nothing at all,
    // rather than silently selecting a neighbour.
    if (player.unlockedForms.includes(candidate)) requested = candidate;
  } else if (input.buttons.formNext.pressed) {
    requested = nextUnlockedForm(player.form, player.unlockedForms, 1);
  } else if (input.buttons.formPrev.pressed) {
    requested = nextUnlockedForm(player.form, player.unlockedForms, -1);
  }

  if (requested === null || requested === player.form) return;

  const from = player.form;
  player.form = requested;
  world.stage.formsUsed.add(requested);
  // Switching mid-charge discards the charge: the note being built belonged to
  // the old form. Keeping it would let a player charge with a cheap form and
  // release with an expensive one.
  player.chargeHeldSeconds = 0;
  player.chargeTier = 0;
  player.isCharging = false;
  events.emit('form:switched', { from, to: requested });
}

function applyPassives(ctx: Parameters<System>[0]): void {
  const { world, dt, services } = ctx;
  const player = world.player;

  switch (player.form) {
    case 'bloom': {
      // Bloom returns Coherence, but only while grounded and not being hit —
      // it rewards holding ground, not turtling through damage.
      if (player.grounded && player.invulnerableRemaining <= 0 && !player.hurtThisStep) {
        if (player.coherence < player.maxCoherence) {
          services.restoreCoherence(BLOOM_REGEN_PER_SECOND * dt);
        }
      }
      break;
    }

    case 'silence': {
      // A standing field rather than a one-off: refreshed every quarter second
      // so an enemy that wanders in is muted without the field having to be
      // recast.
      for (const enemy of world.enemies) {
        if (enemy.dead) continue;
        const dx = enemy.position.x - player.position.x;
        const dy = enemy.position.y - player.position.y;
        const dz = enemy.position.z - player.position.z;
        if (dx * dx + dy * dy + dz * dz <= SILENCE_FIELD_RADIUS * SILENCE_FIELD_RADIUS) {
          enemy.silencedRemaining = Math.max(enemy.silencedRemaining, SILENCE_REFRESH_SECONDS);
        }
      }
      break;
    }

    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Behaviour hooks
// ---------------------------------------------------------------------------

/** Angles used when Choir Form fans a press into several voices, in radians. */
const CHOIR_SPREAD = [-0.22, 0.22, -0.44, 0.44] as const;

const BEHAVIOURS: Readonly<Partial<Record<ResonanceFormId, FormBehaviour>>> = {
  echo: {
    id: 'echo',
    onFire(context) {
      // One repeat by default; the upgrade path adds a second.
      context.setEchoes(1);
    },
    onProjectileEnd(context) {
      // A shot that ran its course leaves a standing wave to walk on. One that
      // struck something spent itself on the target instead — otherwise every
      // fight would litter the arena with platforms.
      if (!context.hitSomething) {
        context.spawnPlatform(context.position, 1.15, 4.5);
      }
    },
  },

  prism: {
    id: 'prism',
    onFire(context) {
      context.setBounces(2);
      // Charged notes refract; uncharged ones only bounce. That keeps the split
      // as something the player chooses rather than something that happens.
      if (context.tier > 0) {
        context.spawnAdditional({ x: 0, y: 0, z: 0 }, 0.5);
      }
    },
  },

  choir: {
    id: 'choir',
    onFire(context) {
      // Each voice is individually weak; together they cover an arc. The
      // damage scale is what stops a fan of five from out-damaging a charge.
      const voices = context.tier > 0 ? 4 : 2;
      for (let i = 0; i < voices; i++) {
        const angle = CHOIR_SPREAD[i] ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dir = context.direction;
        context.spawnAdditional(
          { x: dir.x * cos - dir.z * sin, y: dir.y, z: dir.x * sin + dir.z * cos },
          0.7,
        );
      }
    },
  },

  ember: {
    id: 'ember',
    onFire(context) {
      // Ember trades cadence for weight, and the charge is where that lands.
      if (context.tier > 0) context.setDamageScale(1.35);
    },
    onBurst(context) {
      // The detonation is the burst, so it hits harder in a smaller space.
      context.rootEnemiesInRadius(0.4);
    },
  },

  bloom: {
    id: 'bloom',
    onBurst(context) {
      context.rootEnemiesInRadius(BLOOM_ROOT_SECONDS);
      context.restoreCoherence(6);
    },
    onProjectileEnd(context) {
      if (!context.hitSomething) {
        context.spawnPlatform(context.position, 1.4, 6);
      }
    },
  },

  silence: {
    id: 'silence',
    onBurst(context) {
      context.silenceEnemiesInRadius(SILENCE_BURST_SECONDS);
    },
  },

  tidal: {
    id: 'tidal',
    onFire(context) {
      // Slower, heavier notes that push. Reach is the trade.
      context.setDamageScale(1.05);
    },
    onProjectileEnd(context) {
      if (!context.hitSomething) {
        context.spawnPlatform(context.position, 1.25, 3.5);
      }
    },
  },

  celestial: {
    id: 'celestial',
    onFire(context) {
      if (context.tier > 0) context.setDamageScale(1.25);
      context.setBounces(1);
    },
    onBurst(context) {
      context.restoreCoherence(4);
    },
  },
};

/**
 * Hooks for a form, or `null` for forms that need none.
 *
 * `base` deliberately has no behaviour: the untransformed Auralith is the
 * baseline every other form is measured against, and giving it a quirk would
 * blur that.
 */
export function getFormBehaviour(form: ResonanceFormId): FormBehaviour | null {
  return BEHAVIOURS[form] ?? null;
}

/** Per-form multipliers, clamped so content data cannot produce absurd values. */
export function formTuningFor(form: ResonanceFormId): {
  damageScale: number;
  fireIntervalScale: number;
  projectileSpeedScale: number;
  harmonicDegree: number;
  colour: string;
} {
  const def = RESONANCE_FORMS[form];
  return {
    damageScale: clamp(def.tuning.damageScale, 0.1, 4),
    fireIntervalScale: clamp(def.tuning.fireIntervalScale, 0.25, 4),
    projectileSpeedScale: clamp(def.tuning.projectileSpeedScale, 0.25, 4),
    harmonicDegree: def.tuning.harmonicDegree,
    colour: def.tuning.colour,
  };
}

export { RESONANCE_FORMS, FORM_WHEEL_ORDER };
