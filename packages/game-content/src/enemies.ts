import type { EnemyArchetypeDef } from '@tuner/game-core';

/**
 * The Detuner bestiary.
 *
 * Every unit here is an invader: angular obsidian-and-violet crystal, a single
 * luminous eye, a violet core that reads as the 440 Hz infection against the
 * navy grounds and gold sacred geometry of the world. Six families, mapped onto
 * the nine `EnemyRole` behaviours the enemy framework instantiates:
 *
 * - **Whisperers** — small skittering scouts, low chattering silhouettes.
 * - **Drifters** — flying dart-shaped harassers.
 * - **Fractures** — heavy crystalline brutes carrying plated armour.
 * - **Amplifiers** — squat turret pylons that broadcast the detuned signal.
 * - **Conductors** — robed command units with staves, the only Detuners that
 *   direct others.
 * - **Corrupted wildlife and guardians** — not Detuners at all: creatures and
 *   protectors of the region caught in the infection. These are marked
 *   `cleansable` and are restored, never destroyed.
 *
 * Authoring rules that hold across the whole table, and that
 * `bestiary.test.ts` enforces:
 *
 * 1. `telegraphSeconds` is never below 0.35. An attack the player cannot read
 *    is not a difficulty setting, it is a bug.
 * 2. `attackRadius` never exceeds `aggroRadius` — nothing shoots from outside
 *    the range at which it visibly notices you.
 * 3. Armoured units always list `armourBreakers`, and every one of them yields
 *    to `charge` or `counter`. Both are base-Auralith verbs, so armour is a
 *    prompt to use the whole kit, never a form gate.
 * 4. Numbers are stated against the player's baseline: 100 Coherence, a 10
 *    damage pulse every 0.14 s, and charge tiers of 26 / 52 / 92.
 */

export const ENEMY_ARCHETYPES: Readonly<Record<string, EnemyArchetypeDef>> = {
  // -------------------------------------------------------------------------
  // Whisperers — scouts
  // -------------------------------------------------------------------------

  /**
   * The first Detuner the player ever meets. A fist-sized shard body on four
   * folded legs, one violet eye, skitters in short arcs and stops to listen.
   * Three pulses kill it; its whole job is to teach that enemies wind up before
   * they lunge.
   */
  whisperer: {
    id: 'whisperer',
    displayName: 'Whisperer',
    role: 'scout',
    health: 24,
    contactDamage: 6,
    moveSpeed: 6.2,
    turnSpeed: 7.5,
    aggroRadius: 14,
    attackRadius: 1.8,
    telegraphSeconds: 0.45,
    attackCooldown: 1.4,
    bodyRadius: 0.34,
    bodyHeight: 0.7,
    signalSampleId: 'signal-whisperer-chitter',
  },

  /**
   * Bred from a broken Whisperer: half the mass, twice the nerve. Arrives in
   * groups of four to six and always from two directions at once, so the player
   * learns to use the Harmonic Burst instead of aiming at each one.
   */
  'whisperer-swarm': {
    id: 'whisperer-swarm',
    displayName: 'Swarm Whisperer',
    role: 'scout',
    health: 12,
    contactDamage: 4,
    moveSpeed: 7.6,
    turnSpeed: 9,
    aggroRadius: 16,
    attackRadius: 1.4,
    telegraphSeconds: 0.35,
    attackCooldown: 0.9,
    bodyRadius: 0.26,
    bodyHeight: 0.52,
    signalSampleId: 'signal-whisperer-swarm',
  },

  // -------------------------------------------------------------------------
  // Drifters — flyers
  // -------------------------------------------------------------------------

  /**
   * A dart of black glass trailing a violet spore sac. Hovers at head height,
   * drifts sideways to keep its distance, and lobs a slow spore bolt the player
   * can counter straight back into it.
   */
  'spore-drifter': {
    id: 'spore-drifter',
    displayName: 'Spore Drifter',
    role: 'flyer',
    health: 30,
    contactDamage: 7,
    moveSpeed: 7,
    turnSpeed: 4.2,
    aggroRadius: 18,
    attackRadius: 11,
    telegraphSeconds: 0.6,
    attackCooldown: 2.2,
    projectile: {
      speed: 17,
      damage: 8,
      radius: 0.3,
      count: 1,
      counterable: true,
    },
    bodyRadius: 0.42,
    bodyHeight: 0.6,
    flying: true,
    signalSampleId: 'signal-spore-drifter',
  },

  /**
   * The Glass Meridian variant: thinner, faster, and it splits its shot into a
   * three-shard fan. Fragile enough that a single charged shot clears it, which
   * is the point — it punishes standing still, not poor aim.
   */
  'glass-drifter': {
    id: 'glass-drifter',
    displayName: 'Glass Drifter',
    role: 'flyer',
    health: 26,
    contactDamage: 6,
    moveSpeed: 8.8,
    turnSpeed: 5.4,
    aggroRadius: 20,
    attackRadius: 13,
    telegraphSeconds: 0.5,
    attackCooldown: 2.6,
    projectile: {
      speed: 22,
      damage: 6,
      radius: 0.22,
      count: 3,
      spreadRadians: 0.26,
      counterable: true,
    },
    bodyRadius: 0.36,
    bodyHeight: 0.5,
    flying: true,
    signalSampleId: 'signal-glass-drifter',
  },

  /**
   * Not a Detuner: a broad-winged moth native to the Fractured Garden, its wing
   * plates stained violet by the infection. It blunders rather than hunts.
   * Cleansing one restores its cyan wing-glyphs and it stays in the arena as
   * ambient life — the first thing that teaches the player cleansing is not
   * killing.
   */
  'sanctum-moth': {
    id: 'sanctum-moth',
    displayName: 'Sanctum Moth',
    role: 'flyer',
    health: 18,
    contactDamage: 5,
    moveSpeed: 5.6,
    turnSpeed: 3,
    aggroRadius: 12,
    attackRadius: 2.2,
    telegraphSeconds: 0.55,
    attackCooldown: 2,
    bodyRadius: 0.44,
    bodyHeight: 0.44,
    flying: true,
    cleansable: true,
    signalSampleId: 'signal-sanctum-moth',
  },

  // -------------------------------------------------------------------------
  // Fractures — shield brutes
  // -------------------------------------------------------------------------

  /**
   * A slab of fused root and black crystal that walks. It carries its armour on
   * the front face only, so the fight is a positioning puzzle: circle it, or
   * break the plate with a charged shot or a counter. Slow enough that its
   * overhead smash is always readable.
   */
  'root-fracture': {
    id: 'root-fracture',
    displayName: 'Root Fracture',
    role: 'shield',
    health: 120,
    armour: 40,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 16,
    moveSpeed: 2.6,
    turnSpeed: 1.8,
    aggroRadius: 13,
    attackRadius: 2.8,
    telegraphSeconds: 0.85,
    attackCooldown: 2.4,
    bodyRadius: 0.85,
    bodyHeight: 2.3,
    signalSampleId: 'signal-root-fracture',
  },

  /**
   * The Fallen Sanctuary pattern: quarried stone wrapped around a violet core,
   * lighter plating than its Garden cousin and a shorter wind-up. Introduced
   * beside the first charge-shot tutorial for exactly that reason.
   */
  'stone-fracture': {
    id: 'stone-fracture',
    displayName: 'Stone Fracture',
    role: 'shield',
    health: 90,
    armour: 26,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 13,
    moveSpeed: 3.2,
    turnSpeed: 2.2,
    aggroRadius: 12,
    attackRadius: 2.4,
    telegraphSeconds: 0.7,
    attackCooldown: 2.1,
    bodyRadius: 0.72,
    bodyHeight: 2,
    signalSampleId: 'signal-stone-fracture',
  },

  // -------------------------------------------------------------------------
  // Amplifiers — turrets
  // -------------------------------------------------------------------------

  /**
   * A squat three-legged pylon, bolted where it stands, broadcasting the
   * detuned signal from a slotted violet lens. It cannot move or chase; it
   * denies ground. Its shots are counterable, which turns a defended corridor
   * into a rhythm exercise.
   */
  'amplifier-pylon': {
    id: 'amplifier-pylon',
    displayName: 'Amplifier Pylon',
    role: 'turret',
    health: 60,
    armour: 18,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 8,
    moveSpeed: 0,
    turnSpeed: 2.4,
    aggroRadius: 22,
    attackRadius: 20,
    telegraphSeconds: 0.75,
    attackCooldown: 2.6,
    projectile: {
      speed: 20,
      damage: 11,
      radius: 0.32,
      count: 1,
      counterable: true,
    },
    bodyRadius: 0.7,
    bodyHeight: 1.5,
    signalSampleId: 'signal-amplifier-pylon',
  },

  /**
   * Two lenses on one column, firing a four-shot volley across a wide arc. The
   * long wind-up and the visible arc give the player time to pick a lane; the
   * cooldown is long enough to close the distance in one dash chain.
   */
  'twin-amplifier': {
    id: 'twin-amplifier',
    displayName: 'Twin Amplifier',
    role: 'turret',
    health: 78,
    armour: 20,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 9,
    moveSpeed: 0,
    turnSpeed: 1.9,
    aggroRadius: 24,
    attackRadius: 21,
    telegraphSeconds: 0.9,
    attackCooldown: 3.2,
    projectile: {
      speed: 18,
      damage: 8,
      radius: 0.28,
      count: 4,
      spreadRadians: 0.34,
      counterable: true,
    },
    bodyRadius: 0.8,
    bodyHeight: 1.9,
    signalSampleId: 'signal-twin-amplifier',
  },

  /**
   * A Glass Meridian pylon faced with mirrored plate. Ordinary pulses skate off
   * the mirror; a counter or a Harmonic Burst shears the plate away. Fires one
   * heavy slow orb that can be returned, and returned orbs shatter the mirror
   * outright.
   */
  'mirror-pylon': {
    id: 'mirror-pylon',
    displayName: 'Mirror Pylon',
    role: 'turret',
    health: 54,
    armour: 22,
    armourBreakers: ['counter', 'burst'],
    contactDamage: 8,
    moveSpeed: 0,
    turnSpeed: 2.1,
    aggroRadius: 21,
    attackRadius: 18,
    telegraphSeconds: 0.8,
    attackCooldown: 2.9,
    projectile: {
      speed: 12,
      damage: 13,
      radius: 0.45,
      count: 1,
      counterable: true,
    },
    bodyRadius: 0.66,
    bodyHeight: 1.6,
    signalSampleId: 'signal-mirror-pylon',
  },

  // -------------------------------------------------------------------------
  // Pursuers
  // -------------------------------------------------------------------------

  /**
   * A four-limbed crystalline runner built around a violet spine. It closes
   * faster than the player runs, so it must be dashed past or countered rather
   * than outrun — the unit that makes the dash feel necessary.
   */
  'thorn-pursuer': {
    id: 'thorn-pursuer',
    displayName: 'Thorn Pursuer',
    role: 'pursuer',
    health: 52,
    contactDamage: 12,
    moveSpeed: 9.4,
    turnSpeed: 5.5,
    aggroRadius: 20,
    attackRadius: 2.2,
    telegraphSeconds: 0.5,
    attackCooldown: 1.6,
    bodyRadius: 0.5,
    bodyHeight: 1.3,
    signalSampleId: 'signal-thorn-pursuer',
  },

  /**
   * A Garden hound, all bramble and long stride, infected rather than alien:
   * violet sap runs the length of its back and it howls at 440 Hz. It breaks
   * off pursuit once cleansed and will follow the player at a distance
   * afterwards.
   */
  'bramble-hound': {
    id: 'bramble-hound',
    displayName: 'Bramble Hound',
    role: 'pursuer',
    health: 44,
    contactDamage: 10,
    moveSpeed: 8.8,
    turnSpeed: 6.2,
    aggroRadius: 19,
    attackRadius: 2,
    telegraphSeconds: 0.55,
    attackCooldown: 1.8,
    bodyRadius: 0.46,
    bodyHeight: 1.1,
    cleansable: true,
    signalSampleId: 'signal-bramble-hound',
  },

  // -------------------------------------------------------------------------
  // Spawners
  // -------------------------------------------------------------------------

  /**
   * A rooted violet pod ringed with gold-black sepals that peel open on a slow
   * beat and shed Swarm Whisperers. Cannot move, cannot be starved out: the
   * fight is over when the pod is, which is the lesson.
   */
  'bloom-spawner': {
    id: 'bloom-spawner',
    displayName: 'Bloom Spawner',
    role: 'spawner',
    health: 86,
    contactDamage: 9,
    moveSpeed: 0,
    turnSpeed: 1.2,
    aggroRadius: 24,
    attackRadius: 3,
    telegraphSeconds: 0.9,
    attackCooldown: 3.4,
    spawns: { archetype: 'whisperer-swarm', interval: 4.5, max: 4 },
    bodyRadius: 0.9,
    bodyHeight: 2,
    signalSampleId: 'signal-bloom-spawner',
  },

  /**
   * A tethered seed-cluster that hangs from ceilings and vents Spore Drifters.
   * Placed above arenas so the player has to break line of sight upward, which
   * is how vertical space gets used in an otherwise ground-level fight.
   */
  'chorus-seed': {
    id: 'chorus-seed',
    displayName: 'Chorus Seed',
    role: 'spawner',
    health: 70,
    armour: 14,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 7,
    moveSpeed: 0,
    turnSpeed: 1,
    aggroRadius: 26,
    attackRadius: 4,
    telegraphSeconds: 1,
    attackCooldown: 4,
    spawns: { archetype: 'spore-drifter', interval: 6, max: 3 },
    bodyRadius: 0.75,
    bodyHeight: 1.4,
    flying: true,
    signalSampleId: 'signal-chorus-seed',
  },

  // -------------------------------------------------------------------------
  // Hazards
  // -------------------------------------------------------------------------

  /**
   * A slow violet octahedron that drifts along a fixed line, pulsing brighter
   * as the player nears. It is both a creature and a moving obstacle: shooting
   * one detonates it early and safely, so a corridor of them is a puzzle about
   * ordering, not reflexes.
   */
  'drifting-mine': {
    id: 'drifting-mine',
    displayName: 'Drifting Mine',
    role: 'hazard',
    health: 14,
    contactDamage: 18,
    moveSpeed: 1.8,
    turnSpeed: 0.8,
    aggroRadius: 30,
    attackRadius: 1.6,
    telegraphSeconds: 0.5,
    attackCooldown: 2,
    bodyRadius: 0.45,
    bodyHeight: 0.9,
    flying: true,
    signalSampleId: 'signal-drifting-mine',
  },

  /**
   * An infected flower rooted in the Garden path: it inhales, then exhales a
   * slow ring of spore motes at ankle height. Cleansing it opens the ring into
   * a green bloom that heals nothing but marks the path as reclaimed.
   */
  'dissonance-bloom': {
    id: 'dissonance-bloom',
    displayName: 'Dissonance Bloom',
    role: 'hazard',
    health: 30,
    contactDamage: 6,
    moveSpeed: 0,
    turnSpeed: 0.6,
    aggroRadius: 10,
    attackRadius: 8,
    telegraphSeconds: 0.7,
    attackCooldown: 3,
    projectile: {
      speed: 6,
      damage: 7,
      radius: 0.6,
      count: 6,
      spreadRadians: 1.05,
      counterable: false,
    },
    bodyRadius: 0.6,
    bodyHeight: 1.1,
    cleansable: true,
    signalSampleId: 'signal-dissonance-bloom',
  },

  // -------------------------------------------------------------------------
  // Mimics
  // -------------------------------------------------------------------------

  /**
   * A featureless obsidian figure that samples the player's equipped Resonance
   * Form and fires it back, one beat behind. Every one of its shots is
   * counterable — the fight is a conversation, and the honest answer is to
   * return its own note.
   */
  'frequency-mimic': {
    id: 'frequency-mimic',
    displayName: 'Frequency Mimic',
    role: 'mimic',
    health: 46,
    contactDamage: 9,
    moveSpeed: 5.5,
    turnSpeed: 6,
    aggroRadius: 17,
    attackRadius: 14,
    telegraphSeconds: 0.5,
    attackCooldown: 1.9,
    projectile: {
      speed: 24,
      damage: 9,
      radius: 0.3,
      count: 1,
      counterable: true,
    },
    bodyRadius: 0.4,
    bodyHeight: 1.6,
    signalSampleId: 'signal-frequency-mimic',
  },

  /**
   * Sits on a plinth wearing the silhouette of a Resonance Shard, humming
   * eight cents flat. Resonance Sight exposes it instantly, and so does simply
   * listening — the accessibility layer draws the flat pitch as a tilted glyph.
   */
  'false-shard': {
    id: 'false-shard',
    displayName: 'False Shard',
    role: 'mimic',
    health: 20,
    contactDamage: 14,
    moveSpeed: 4.6,
    turnSpeed: 7,
    aggroRadius: 4,
    attackRadius: 1.6,
    telegraphSeconds: 0.4,
    attackCooldown: 1.5,
    bodyRadius: 0.3,
    bodyHeight: 0.62,
    signalSampleId: 'signal-false-shard',
  },

  // -------------------------------------------------------------------------
  // Elites
  // -------------------------------------------------------------------------

  /**
   * A robed Conductor: a tall hooded frame of overlapping black plates, a staff
   * ending in a slowly rotating violet ring, and no legs the player ever sees.
   * It does not fight so much as arrange the fight — it summons Whisperers,
   * hardens nearby armour and shifts its own plating between wind-ups, and it
   * has two distinct stances the renderer reads off `phase`.
   */
  'conductor-elite': {
    id: 'conductor-elite',
    displayName: 'Conductor',
    role: 'elite',
    health: 260,
    armour: 30,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 14,
    moveSpeed: 4.2,
    turnSpeed: 3.4,
    aggroRadius: 26,
    attackRadius: 16,
    telegraphSeconds: 1,
    attackCooldown: 2.8,
    projectile: {
      speed: 16,
      damage: 12,
      radius: 0.4,
      count: 3,
      spreadRadians: 0.5,
      counterable: true,
    },
    spawns: { archetype: 'whisperer', interval: 7, max: 3 },
    bodyRadius: 0.75,
    bodyHeight: 2.6,
    signalSampleId: 'signal-conductor-elite',
  },

  /**
   * One of the Garden's own stone protectors, overgrown with violet crystal and
   * still trying to do its job — it plants itself between the player and the
   * seedbeds rather than hunting. Heavy plate, long readable wind-ups, and it
   * never lands a killing blow: at zero it kneels, and the retuning finishes
   * it. Restored, it stands as a landmark for the rest of the run.
   */
  'infected-garden-guardian': {
    id: 'infected-garden-guardian',
    displayName: 'Infected Garden Guardian',
    role: 'elite',
    health: 300,
    armour: 36,
    armourBreakers: ['charge', 'counter'],
    contactDamage: 15,
    moveSpeed: 3.6,
    turnSpeed: 2,
    aggroRadius: 18,
    attackRadius: 3.6,
    telegraphSeconds: 1.1,
    attackCooldown: 3,
    bodyRadius: 1.1,
    bodyHeight: 3.2,
    cleansable: true,
    signalSampleId: 'signal-garden-guardian',
  },
};
