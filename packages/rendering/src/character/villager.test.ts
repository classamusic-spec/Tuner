import { describe, expect, it } from 'vitest';
import { PALETTE } from '@tuner/shared';
import {
  SPEAKING_TURN_RADIANS,
  VILLAGER_APPEARANCES,
  VILLAGER_PALETTE,
  headYawFor,
  isDetuned,
  villagerAppearance,
  yawTowards,
} from './villager-appearance.js';

/**
 * The game's forward vector, from `movement.ts`: a yaw of zero faces −Z, so
 * `forward(yaw) = (−sin yaw, −cos yaw)`. Written out here rather than imported
 * so this file is asserting against the *documented* convention rather than
 * against whatever the code currently does.
 */
function forward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/**
 * The survivor cast.
 *
 * These assert that a survivor's look says what the story says. A villager
 * rendered with the wrong palette is not a crash — it is a person the player
 * misreads, which is worse.
 *
 * The matching check that every appearance key the *content* names has a look
 * defined for it lives in `tests/integration/adventure-integration.test.ts`.
 * It cannot live here: `@tuner/rendering` does not depend on
 * `@tuner/game-content` and must not start, or the presentation layer becomes
 * unusable for any content but this game's.
 */

describe('the survivor cast', () => {
  it('falls back to a plain survivor rather than throwing on an unknown key', () => {
    // A nameless extra standing in a village is recoverable. A crash is not.
    const fallback = villagerAppearance('survivor-nobody-wrote-this');
    expect(fallback.build).toBe('listener');
    expect(fallback.infection).toBe(0);
  });

  it('shows the infection on exactly one survivor, and it is Tarn', () => {
    const detuned = Object.keys(VILLAGER_APPEARANCES).filter(isDetuned);
    expect(detuned).toEqual(['survivor-detuned']);

    // The same violet the walls and the Detuners use. A second infection colour
    // would say there are two infections.
    expect(VILLAGER_PALETTE.detuned).toBe(PALETTE.infection);
    expect(VILLAGER_PALETTE.restored).toBe(PALETTE.resonance);
  });

  it('never leaves a restored survivor still carrying the infection', () => {
    for (const [key, look] of Object.entries(VILLAGER_APPEARANCES)) {
      if (!key.endsWith('-restored')) continue;
      expect(look.infection, `${key} is restored and still infected`).toBe(0);
      expect(look.restoration, `${key} is restored and does not show it`).toBeGreaterThan(0);
    }
  });

  it('straightens people up when their region comes back', () => {
    // Restoration has to be visible in the body, not only in the dialogue.
    for (const [key, look] of Object.entries(VILLAGER_APPEARANCES)) {
      if (!key.endsWith('-restored')) continue;
      const before = VILLAGER_APPEARANCES[key.replace('-restored', '')];
      if (!before) continue;
      expect(look.stoop, `${key} stands no straighter than before`).toBeLessThan(before.stoop);
    }
  });

  it('keeps the survivors dressed differently from the Tuner', () => {
    // She arrived from somewhere with dye. They have been living in a poisoned
    // garden. If their cloth matched hers they would read as her colleagues.
    for (const look of Object.values(VILLAGER_APPEARANCES)) {
      expect(look.cloth).not.toBe(PALETTE.gold);
      expect(look.cloth).not.toBe(PALETTE.infection);
    }
  });

  it('makes Oru unmistakably larger than the people he protected', () => {
    const oru = villagerAppearance('oru-freed');
    const person = villagerAppearance('survivor-gardener');
    expect(oru.scale / person.scale).toBeGreaterThan(2.5);
    expect(oru.build).toBe('colossus');
  });

  it('gives each build a different prop, because that is the read at distance', () => {
    expect(villagerAppearance('survivor-gardener').prop).toBe('watering-can');
    expect(villagerAppearance('survivor-watcher').prop).toBe('spyglass');
    expect(villagerAppearance('survivor-detuned').prop).toBe('none');
  });
});

describe('which way a survivor faces', () => {
  /*
    A 180° error here is invisible to every other test in the project — 87
    adventure assertions passed with it in place — and completely obvious the
    first time somebody looks at the screen, because the villager greets the
    player with the back of her head. The fix is one sign; the assertion that
    catches it has to compare against the forward vector, not against itself.
  */
  it('points a body at what it is facing, on all four axes', () => {
    const cases = [
      { dx: 0, dz: -1, name: 'north (−Z), the zero-yaw direction' },
      { dx: 0, dz: 1, name: 'south (+Z)' },
      { dx: 1, dz: 0, name: 'east (+X)' },
      { dx: -1, dz: 0, name: 'west (−X)' },
      { dx: 3, dz: -4, name: 'an off-axis bearing' },
    ];
    for (const { dx, dz, name } of cases) {
      const f = forward(yawTowards(dx, dz));
      const span = Math.hypot(dx, dz);
      expect(f.x, name).toBeCloseTo(dx / span, 6);
      expect(f.z, name).toBeCloseTo(dz / span, 6);
    }
  });

  it('faces zero yaw down −Z, which is what the rest of the game assumes', () => {
    expect(yawTowards(0, -1)).toBeCloseTo(0, 6);
  });
});

describe('looking at whoever is talking to you', () => {
  it('does not turn a head that is not being spoken to', () => {
    expect(headYawFor(0, Math.PI, false)).toBe(0);
  });

  it('turns toward the player when speaking', () => {
    // Body faces +Z; player is off to one side.
    expect(headYawFor(0, 0.3, true)).toBeCloseTo(0.3, 6);
    expect(headYawFor(0, -0.3, true)).toBeCloseTo(-0.3, 6);
  });

  it('never rotates a neck further than a neck goes', () => {
    expect(headYawFor(0, Math.PI, true)).toBeLessThanOrEqual(SPEAKING_TURN_RADIANS);
    expect(headYawFor(0, -Math.PI, true)).toBeGreaterThanOrEqual(-SPEAKING_TURN_RADIANS);
  });

  it('takes the short way round the wrap', () => {
    // Body at +3.0 rad, player at −3.0 rad: 0.28 rad apart the short way, not
    // 6.0 the long way. Getting this wrong spins heads the wrong direction.
    const yaw = headYawFor(3.0, -3.0, true);
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThanOrEqual(SPEAKING_TURN_RADIANS);
  });
});
