import { clamp, clone, type ResonanceFormId, type Vec3 } from '@tuner/shared';
import type { SimContext, System } from '../internal/context.js';
import type { FormBehaviour } from '../forms.js';
import {
  FORM_WHEEL_ORDER,
  RESONANCE_FORMS,
  RESONANCE_SIGHT_REVEALS,
  type ResonanceSightCategory,
  type ResonanceSightReveal,
} from './forms-registry.js';

/**
 * Ability switching, passives and per-ability behaviour.
 *
 * Three rules shape this file.
 *
 * **Switching is instant.** No cooldown, no animation lock, no commitment
 * window. A system that punishes experimentation does not get experimented
 * with, and the whole point of eight abilities is that the player reaches for a
 * different one the moment the first answer stops working. The one thing a
 * switch does cost is an in-progress charge: the note being built belonged to
 * the ability that started it, so charging with a cheap ability and releasing
 * with an expensive one is not a trade the system offers.
 *
 * **Abilities attach only through hooks and passives.** An ability may modify a
 * shot it just fired, react when one of its shots ends, react to a Harmonic
 * Burst, or run a passive here. It cannot reach anywhere else. That constraint
 * is what keeps eight sets of special behaviour from turning combat into one
 * enormous switch statement.
 *
 * **Every passive that matters is visible.** Anything a passive does that the
 * player must notice — stepping through an attack untouched, a projectile dying
 * at the edge of a Silence Field, a creature going quiet — also emits
 * `form:abilityUsed`, so the renderer can draw it and the game stays completable
 * with the sound off. The passives themselves are written here rather than in
 * `FormBehaviour.onStep` because that hook is deliberately observation-only: it
 * receives position and grounding and is handed no way to mutate the world.
 */

// ---------------------------------------------------------------------------
// Passive tuning
// ---------------------------------------------------------------------------

/** Coherence per second Bloom Wave returns, while grounded and unharmed. */
const BLOOM_REGEN_PER_SECOND = 3.2;

/** Radius within which a Silence Field mutes creatures and eats projectiles. */
const SILENCE_FIELD_RADIUS = 9;
/** Re-applied every step, so a creature that wanders in is muted immediately. */
const SILENCE_REFRESH_SECONDS = 0.25;

/** Seconds Bloom Wave's roots and a Silence Field's muting last from a burst. */
const BLOOM_ROOT_SECONDS = 2.4;
const SILENCE_BURST_SECONDS = 3;

/**
 * Seconds Resonance Thread restrains a creature. Deliberately far short of
 * Bloom's roots: the thread holds something while you do one thing, not while
 * you do everything.
 */
const TIDAL_RESTRAIN_SECONDS = 1.2;

/**
 * Fraction of a lit resonator's decay the thread carries for it, so a struck
 * resonator holds roughly twice as long. Bounded on purpose — enough to reach a
 * second resonator across a room, never enough to hold a puzzle open forever.
 */
const THREAD_CONDUCTION_SHARE = 0.5;

/** Extra dash-cooldown drain, as a fraction of the step, for Pulse Step. */
const PULSE_STEP_COOLDOWN_RELIEF = 0.6;
/** Seconds of untouchable frames added on top of the step's own duration. */
const PULSE_STEP_DODGE_GRACE = 0.06;
/** How close a resonant anchor must be for a step to chain off it, in metres. */
const PULSE_STEP_CHAIN_RANGE = 7;

/**
 * Share of each earned ability's passive that World Chord carries.
 *
 * The finale ability is not a ninth colour of gun: it is every restored fragment
 * held at once, so each ability the Tuner has actually earned keeps working
 * underneath it at half strength. An ability never earned contributes nothing,
 * which keeps the finale a record of the journey rather than a reset of it.
 */
const CELESTIAL_SHARE = 0.5;

// ---------------------------------------------------------------------------
// Wheel arithmetic
// ---------------------------------------------------------------------------

export function formCount(): number {
  return FORM_WHEEL_ORDER.length;
}

/** Resolves a wheel index to an ability id, wrapping rather than clamping. */
export function formAtIndex(index: number): ResonanceFormId {
  const count = FORM_WHEEL_ORDER.length;
  const wrapped = ((index % count) + count) % count;
  return FORM_WHEEL_ORDER[wrapped] ?? 'base';
}

/** Wheel position of an ability, or 0 if somehow unknown. */
export function indexOfForm(form: ResonanceFormId): number {
  const index = FORM_WHEEL_ORDER.indexOf(form);
  return index < 0 ? 0 : index;
}

/**
 * Steps through the *unlocked* abilities only.
 *
 * Cycling onto an ability the player has not earned would be worse than useless
 * — it would put a dead slot between them and the ability they wanted, mid-fight.
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

  // Passive effects. These run every step regardless of input, and they run
  // before movement and combat so the values they write (dash charges, dodge
  // frames, resonator sustain) are the ones those systems read this step.
  applyPassives(ctx);

  // The observation-only hook, resolved against whatever is equipped *after* a
  // switch rather than the behaviour the context was built with.
  const behaviour = getFormBehaviour(player.form);
  if (behaviour?.onStep !== undefined) {
    behaviour.onStep({
      deltaSeconds: ctx.dt,
      playerPosition: player.position,
      grounded: player.grounded,
    });
  }

  // Record whatever is equipped, so the results screen can score ability
  // variety honestly rather than only counting deliberate switches.
  world.stage.formsUsed.add(player.form);
};

function resolveSwitch(ctx: SimContext): void {
  const { world, input, events } = ctx;
  const player = world.player;

  let requested: ResonanceFormId | null = null;

  if (input.requestedFormIndex !== null) {
    const candidate = formAtIndex(input.requestedFormIndex);
    // A number key for an ability you have not earned should do nothing at all,
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
  // the old ability.
  player.chargeHeldSeconds = 0;
  player.chargeTier = 0;
  player.isCharging = false;
  events.emit('form:switched', { from, to: requested });
}

// ---------------------------------------------------------------------------
// Passives
// ---------------------------------------------------------------------------

function applyPassives(ctx: SimContext): void {
  const player = ctx.world.player;

  if (player.form === 'celestial') {
    // Iterated in wheel order rather than unlock order, so the composite is
    // identical however the player got here — and so a duplicated entry in
    // `unlockedForms` cannot apply a passive twice.
    for (const owned of FORM_WHEEL_ORDER) {
      if (owned === 'base' || owned === 'celestial') continue;
      if (!player.unlockedForms.includes(owned)) continue;
      applyPassiveFor(ctx, owned, CELESTIAL_SHARE);
    }
    return;
  }

  applyPassiveFor(ctx, player.form, 1);
}

/**
 * One ability's passive, at `share` of full strength.
 *
 * `share` is 1 when the ability is equipped directly and {@link CELESTIAL_SHARE}
 * when World Chord is carrying it.
 */
function applyPassiveFor(ctx: SimContext, form: ResonanceFormId, share: number): void {
  switch (form) {
    case 'bloom':
      applyBloomRegrowth(ctx, share);
      break;
    case 'silence':
      applySilenceField(ctx, share);
      break;
    case 'tidal':
      applyThreadConduction(ctx, share);
      break;
    case 'ember':
      applyPulseStep(ctx, share);
      break;
    // Echo Pulse, Mirror Tone and Split Chord are entirely active: everything
    // they do happens through a fired note or a burst, not in the background.
    default:
      break;
  }
}

/** Bloom Wave: living matter mends, including yours. */
function applyBloomRegrowth(ctx: SimContext, share: number): void {
  const player = ctx.world.player;
  // Rewards holding ground, not turtling through damage.
  if (!player.grounded || player.invulnerableRemaining > 0 || player.hurtThisStep) return;
  if (player.coherence >= player.maxCoherence) return;
  ctx.services.restoreCoherence(BLOOM_REGEN_PER_SECOND * share * ctx.dt);
}

/**
 * Silence Field: a standing field rather than a one-off cast.
 *
 * Two things happen inside it. Creatures that rely on hearing cannot act, and
 * frequency projectiles stop existing at the edge — which is what makes this the
 * ability the finale is built around. Both emit `form:abilityUsed` on the
 * *transition* only, so the renderer gets one cue per event rather than sixty a
 * second.
 */
function applySilenceField(ctx: SimContext, share: number): void {
  const { world } = ctx;
  const player = world.player;
  const radius = SILENCE_FIELD_RADIUS * share;
  const radiusSquared = radius * radius;

  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    if (distanceSquared(enemy.position, player.position) > radiusSquared) continue;
    const wasSilenced = enemy.silencedRemaining > 0;
    enemy.silencedRemaining = Math.max(enemy.silencedRemaining, SILENCE_REFRESH_SECONDS);
    if (!wasSilenced) {
      emitAbility(ctx, 'silence-stealth', enemy.position);
    }
  }

  for (const projectile of world.projectiles) {
    if (projectile.dead || projectile.owner !== 'enemy') continue;
    if (distanceSquared(projectile.position, player.position) > radiusSquared) continue;
    projectile.dead = true;
    emitAbility(ctx, 'silence-stop', projectile.position);
  }
}

/**
 * Resonance Thread: a struck resonator keeps sounding while you cross to the next.
 *
 * The stage system drains `litRemaining` by the raw step; the thread hands half
 * of that back, so the hold window roughly doubles and never exceeds the length
 * the region's author wrote.
 */
function applyThreadConduction(ctx: SimContext, share: number): void {
  const relief = THREAD_CONDUCTION_SHARE * share * ctx.rawDt;
  for (const resonator of ctx.world.stage.resonators.values()) {
    if (resonator.litRemaining <= 0) continue;
    resonator.litRemaining = Math.min(resonator.holdSeconds, resonator.litRemaining + relief);
  }
}

/**
 * Pulse Step: the movement ability.
 *
 * Three passives, all of them written into fields the movement system reads one
 * system later in the same step:
 *
 * 1. **Recovery.** The step's cooldown drains faster than an ordinary dash's.
 * 2. **The dodge.** While the step lasts, the Tuner is untouchable. This is the
 *    ability's combat contribution, and it is why Pulse Step is not merely a
 *    traversal tool.
 * 3. **The chain.** Airborne with the step spent, a resonant anchor within reach
 *    — a creature, a resonator, a conjured platform — returns one charge. The
 *    cooldown still applies, so this is a chain across a space that has
 *    something in it, not free flight across one that does not.
 */
function applyPulseStep(ctx: SimContext, share: number): void {
  const player = ctx.world.player;

  if (player.dashCooldown > 0) {
    const relief = PULSE_STEP_COOLDOWN_RELIEF * share * ctx.dt;
    player.dashCooldown = Math.max(0, player.dashCooldown - relief);
  }

  if (player.dashTimeRemaining > 0) {
    const dodgeSeconds = player.dashTimeRemaining + PULSE_STEP_DODGE_GRACE * share;
    if (player.invulnerableRemaining <= 0) {
      emitAbility(ctx, 'ember-dodge', player.position);
    }
    player.invulnerableRemaining = Math.max(player.invulnerableRemaining, dodgeSeconds);
  }

  if (
    !player.grounded &&
    player.dashesRemaining <= 0 &&
    player.dashCooldown <= 0 &&
    player.dashTimeRemaining <= 0 &&
    hasResonantAnchor(ctx, PULSE_STEP_CHAIN_RANGE * share)
  ) {
    player.dashesRemaining = 1;
    emitAbility(ctx, 'ember-chain', player.position);
  }
}

/** Anything a step can push off: a creature, a resonator, or conjured ground. */
function hasResonantAnchor(ctx: SimContext, range: number): boolean {
  const { world } = ctx;
  const from = world.player.position;
  const rangeSquared = range * range;

  for (const enemy of world.enemies) {
    if (enemy.dead) continue;
    if (distanceSquared(enemy.position, from) <= rangeSquared) return true;
  }
  for (const resonator of world.stage.resonators.values()) {
    if (distanceSquared(resonator.position, from) <= rangeSquared) return true;
  }
  for (const platform of world.conjured) {
    if (platform.lifeRemaining <= 0) continue;
    if (distanceSquared(platform.position, from) <= rangeSquared) return true;
  }
  return false;
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Announces a passive that the player has to be able to see.
 *
 * `form` is whatever is equipped — under World Chord that is `celestial` — while
 * `ability` names the capability that fired, so the renderer can draw the right
 * cue and the accessibility layer can caption it.
 */
function emitAbility(ctx: SimContext, ability: string, position: Vec3): void {
  ctx.events.emit('form:abilityUsed', {
    form: ctx.world.player.form,
    ability,
    position: clone(position),
  });
}

// ---------------------------------------------------------------------------
// Behaviour hooks
// ---------------------------------------------------------------------------

/** Angles Split Chord fans a press across, in radians. */
const CHOIR_SPREAD = [-0.22, 0.22, -0.44, 0.44] as const;

const BEHAVIOURS: Readonly<Partial<Record<ResonanceFormId, FormBehaviour>>> = {
  echo: {
    id: 'echo',
    onFire(context) {
      // The pulse arrives twice from one press; the upgrade path adds a third.
      context.setEchoes(1);
    },
    onProjectileEnd(context) {
      // A pulse that ran its course leaves a standing wave to walk on. One that
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
      // A charged Mirror Tone is a mirrored pair: the note you aimed, and the
      // same note sent back down the line it came from. Uncharged notes only
      // reflect off surfaces, which keeps the mirroring something the player
      // chooses rather than something that merely happens.
      if (context.tier > 0) {
        const dir = context.direction;
        context.spawnAdditional({ x: -dir.x, y: dir.y, z: -dir.z }, 0.5);
      }
    },
  },

  tidal: {
    id: 'tidal',
    onFire(context) {
      // Slower and heavier: the thread carries weight rather than speed.
      context.setDamageScale(1.05);
    },
    onProjectileEnd(context) {
      // Where the thread lands it stays taut for a few seconds — the traversal
      // rail, and the reason a thread shot into nothing is not wasted.
      if (!context.hitSomething) {
        context.spawnPlatform(context.position, 1.25, 3.5);
      }
    },
    onBurst(context) {
      // Restrains rather than harms.
      context.rootEnemiesInRadius(TIDAL_RESTRAIN_SECONDS);
    },
  },

  ember: {
    id: 'ember',
    onBurst(context) {
      // The step's landing, not an explosion: a short hold while you leave.
      context.rootEnemiesInRadius(0.35);
    },
  },

  choir: {
    id: 'choir',
    onFire(context) {
      // Two signals held at once, four when charged. Each voice is individually
      // weak — the damage scale is what stops a fan of five from out-damaging a
      // single charged note.
      const voices = context.tier > 0 ? 4 : 2;
      const dir = context.direction;
      for (let i = 0; i < voices; i++) {
        const angle = CHOIR_SPREAD[i] ?? 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        context.spawnAdditional(
          { x: dir.x * cos - dir.z * sin, y: dir.y, z: dir.x * sin + dir.z * cos },
          0.7,
        );
      }
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
 * Hooks for an ability, or `null` for abilities that need none.
 *
 * `base` deliberately has no behaviour: Open Chord is the baseline every other
 * ability is measured against, and giving it a quirk would blur that.
 */
export function getFormBehaviour(form: ResonanceFormId): FormBehaviour | null {
  return BEHAVIOURS[form] ?? null;
}

/** Per-ability multipliers, clamped so content data cannot produce absurd values. */
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

export {
  RESONANCE_FORMS,
  FORM_WHEEL_ORDER,
  RESONANCE_SIGHT_REVEALS,
  type ResonanceSightCategory,
  type ResonanceSightReveal,
};
