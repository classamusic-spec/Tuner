import { beforeEach, describe, expect, it } from 'vitest';
import { createEventBus, SIM_STEP_SECONDS, type EventBus } from '@tuner/shared';
import { createKinematicWorld } from '@tuner/physics';
import { createEmptyInputFrame, type Action, type InputFrame } from '@tuner/input';
import { createGameCore, type GameCore, type GameEvents } from '@tuner/game-core';
import { CONTENT, FRACTURED_GARDEN_ZONE, TEMPLE_OF_THE_FIRST_BREATH } from '@tuner/game-content';

/**
 * The adventure layer, through the front door.
 *
 * `adventure.test.ts` exercises the runtime directly — it builds an
 * `AdventureRuntime`, hands it a context and checks what it does. That proves
 * the layer works. It does not prove the layer is *reachable*, and those are
 * different claims: a system with a passing unit suite that `createGameCore`
 * never calls is not in the game.
 *
 * So everything here goes through `createGameCore` and `CONTENT`, the same way
 * a host does. If the system is dropped from the systems list, the zone is
 * unregistered from the bundle, or the projection stops being exposed on the
 * facade, these fail and the unit tests do not.
 */

function frameWith(
  overrides: Partial<Omit<InputFrame, 'buttons'>> & { held?: readonly Action[] } = {},
  previous?: InputFrame,
): InputFrame {
  const base = createEmptyInputFrame();
  const held = new Set(overrides.held ?? []);
  const buttons = { ...base.buttons };

  for (const action of Object.keys(buttons) as Action[]) {
    const wasDown = previous?.buttons[action]?.down ?? false;
    const isDown = held.has(action);
    buttons[action] = {
      down: isDown,
      pressed: isDown && !wasDown,
      released: !isDown && wasDown,
      heldSeconds: isDown ? (previous?.buttons[action]?.heldSeconds ?? 0) + SIM_STEP_SECONDS : 0,
    };
  }

  return {
    ...base,
    moveX: overrides.moveX ?? 0,
    moveY: overrides.moveY ?? 0,
    lookX: overrides.lookX ?? 0,
    lookY: overrides.lookY ?? 0,
    buttons,
    requestedFormIndex: overrides.requestedFormIndex ?? null,
    frame: (previous?.frame ?? 0) + 1,
  };
}

function run(
  core: GameCore,
  steps: number,
  input: (step: number, previous: InputFrame) => InputFrame = () => frameWith(),
): void {
  let previous = createEmptyInputFrame();
  for (let i = 0; i < steps; i++) {
    previous = input(i, previous);
    core.step(SIM_STEP_SECONDS, previous);
  }
}

/** Loads the garden at the hollow checkpoint, past the opening scene. */
function loadAtHollow(core: GameCore): void {
  core.loadStage('fractured-garden', { checkpointId: 'cp-02-hollow' });
  core.skipCutscene();
}

/**
 * Walks the player to an NPC using real movement input.
 *
 * Deliberately not a teleport. `core.state` is the read-only projection — a
 * write there lands on a copy and changes nothing — and moving the player by
 * reaching into the simulation would prove that the interaction search works on
 * coordinates rather than that a player can reach the conversation. So this
 * holds a direction and steps until the prompt appears.
 *
 * Movement is camera-relative and the core's default basis puts `moveY = +1`
 * down −Z, so the heading is `(dx, −dz)` normalised. It re-aims every step
 * because Sava patrols her water round and will not wait.
 *
 * It also jumps periodically, which is not padding: the third terrace has a lip
 * between it and the hollow, and steering straight into it stalls the player at
 * z ≈ −44.4, three metres short of a conversation. A person playing would jump
 * it without thinking about it.
 */
function walkTo(core: GameCore, npcId: string, maxSteps = 400): void {
  expect(
    core.npcs.find((n) => n.id === npcId),
    `no NPC "${npcId}" in the projection`,
  ).toBeDefined();

  let previous = createEmptyInputFrame();
  for (let i = 0; i < maxSteps; i++) {
    if (core.adventure.interactionTarget?.npcId === npcId) return;
    const npc = core.npcs.find((n) => n.id === npcId);
    if (!npc) break;
    const player = core.state.player.position;
    const dx = npc.position.x - player.x;
    const dz = npc.position.z - player.z;
    const span = Math.hypot(dx, dz) || 1;
    previous = frameWith(
      { moveX: dx / span, moveY: -dz / span, held: i % 30 === 0 ? ['jump'] : [] },
      previous,
    );
    core.step(SIM_STEP_SECONDS, previous);
  }
  expect(core.adventure.interactionTarget?.npcId, `never reached "${npcId}"`).toBe(npcId);
}

/** Presses interact for exactly one step, then releases. */
function pressInteract(core: GameCore): void {
  let previous = frameWith({ held: ['interact'] });
  core.step(SIM_STEP_SECONDS, previous);
  previous = frameWith({}, previous);
  core.step(SIM_STEP_SECONDS, previous);
}

describe('the adventure layer is wired into the running game', () => {
  let events: EventBus<GameEvents>;
  let core: GameCore;

  beforeEach(() => {
    events = createEventBus<GameEvents>();
    core = createGameCore({
      content: CONTENT,
      physics: createKinematicWorld(),
      events,
      difficulty: 'standard',
      seed: 'adventure-integration',
    });
  });

  it('registers the Fractured Garden zone in the shipped content bundle', () => {
    expect(CONTENT.zones?.['fractured-garden']).toBe(FRACTURED_GARDEN_ZONE);
    expect(CONTENT.templeStages?.[TEMPLE_OF_THE_FIRST_BREATH.id]).toBeDefined();
  });

  it('stands the region up with its people when the stage loads', () => {
    loadAtHollow(core);
    run(core, 10);

    expect(core.npcs.length).toBe(FRACTURED_GARDEN_ZONE.npcs.length);
    // Sava is the region's first conversation and carries no arrival flag, so
    // she must be standing there the moment the player can move.
    const sava = core.npcs.find((n) => n.id === 'npc-sava');
    expect(sava?.present).toBe(true);
  });

  it('leaves a region with no authored zone completely alone', () => {
    core.loadStage('fallen-sanctuary');
    run(core, 10);

    expect(core.npcs).toEqual([]);
    expect(core.adventure.activeDialogue).toBeNull();
    expect(core.adventure.quests).toEqual([]);
  });

  it('opens a conversation when the player walks up and presses interact', () => {
    loadAtHollow(core);
    walkTo(core, 'npc-sava');

    // The prompt has to appear before the press, or the player is guessing.
    expect(core.adventure.interactionTarget?.npcId).toBe('npc-sava');

    const subtitles: string[] = [];
    events.on('ui:subtitle', ({ text }) => subtitles.push(text));
    pressInteract(core);

    expect(core.adventure.activeDialogue).not.toBeNull();
    expect(core.npcs.find((n) => n.id === 'npc-sava')?.speaking).toBe(true);
    // Muted-play guarantee: the beat reached the interface as text, not as sound.
    expect(subtitles.length).toBeGreaterThan(0);
  });

  it('lets the host end a conversation without a step', () => {
    loadAtHollow(core);
    walkTo(core, 'npc-sava');
    pressInteract(core);
    expect(core.adventure.activeDialogue).not.toBeNull();

    expect(core.skipDialogue()).toBe(true);
    expect(core.adventure.activeDialogue).toBeNull();
    // Nothing was talking, so a second call has nothing to do.
    expect(core.skipDialogue()).toBe(false);
  });

  it('holds the adventure layer still while a cutscene plays', () => {
    // The opening scene fires from a trigger 14 m ahead of the spawn, so the
    // player has to walk into it.
    core.loadStage('fractured-garden');
    run(core, 200, (_, previous) => frameWith({ moveY: 1 }, previous));
    expect(core.state.cutsceneId).toBe('cut-garden-overlook');

    // What this proves and what it does not: the adventure step is suppressed
    // while a scene runs, so the interact press that skips the scene cannot also
    // open a conversation in the same step. It does not prove the collision
    // would otherwise happen here — `cut-garden-overlook` sets
    // `playerControlled: false` and the nearest NPC is 33 m away. The guard is
    // for the ambient scenes that do leave the player walking.
    expect(core.adventure.interactionTarget).toBeNull();
    expect(core.adventure.activeDialogue).toBeNull();

    expect(core.skipCutscene()).toBe(true);
    expect(core.adventure.activeDialogue).toBeNull();
  });

  it('keeps the region while the player is inside its temple, minus the villagers', () => {
    loadAtHollow(core);
    walkTo(core, 'npc-sava');
    pressInteract(core);
    run(core, 40);

    // Walking the terraces discovers a map marker and unlocks codex entries.
    // Those are the record of what this player has seen, and they are what must
    // survive going indoors.
    const markers = core.adventure.discoveredMarkers;
    const codex = core.adventure.unlockedCodex;
    expect(markers.length).toBeGreaterThan(0);
    expect(codex.length).toBeGreaterThan(0);

    core.loadTemple(TEMPLE_OF_THE_FIRST_BREATH.id);
    run(core, 10);

    expect(core.stageDef?.displayName).toBe('The Temple of the First Breath');
    // The people do not follow the player underground — their positions are
    // garden coordinates and would put them inside the temple's walls.
    expect(core.npcs.every((n) => !n.present)).toBe(true);
    expect(core.adventure.interactionTarget).toBeNull();
    // But the region's record is intact: going indoors is not leaving.
    expect(core.adventure.discoveredMarkers).toEqual(markers);
    expect(core.adventure.unlockedCodex).toEqual(codex);
  });

  it('keeps presence honest when a region loads straight into a cutscene', () => {
    // The temple opens on `cut-temple-threshold`, which starts on the first step
    // after the load. An earlier version of this wiring suppressed the entire
    // adventure step during a cutscene, so presence never updated and the
    // renderer was handed the garden's villagers — still marked present, still
    // at garden coordinates — inside the temple. Only the interaction search is
    // suspended now.
    loadAtHollow(core);
    run(core, 20);
    expect(core.npcs.some((n) => n.present)).toBe(true);

    core.loadTemple(TEMPLE_OF_THE_FIRST_BREATH.id);
    run(core, 5);

    expect(core.state.cutsceneId).not.toBeNull();
    expect(core.npcs.every((n) => !n.present)).toBe(true);
  });

  it('rebuilds the adventure when the player actually changes region', () => {
    loadAtHollow(core);
    run(core, 10);
    expect(core.npcs.length).toBeGreaterThan(0);

    core.loadStage('fallen-sanctuary');
    run(core, 10);
    expect(core.npcs).toEqual([]);

    core.loadStage('fractured-garden');
    run(core, 10);
    // Exactly the authored count. Re-entering must not stand a second copy of
    // every villager inside the first.
    expect(core.npcs.length).toBe(FRACTURED_GARDEN_ZONE.npcs.length);
  });

  it('refuses a temple that is not registered rather than loading nothing', () => {
    expect(() => core.loadTemple('temple-that-does-not-exist')).toThrow(
      /No temple content registered/,
    );
  });

  it('projects at most once per step however often the host reads it', () => {
    loadAtHollow(core);
    run(core, 10);

    // The renderer reads `npcs` every frame and the HUD reads `adventure` ten
    // times a second. Both must be the same object until the world moves on.
    const npcsA = core.npcs;
    const stateA = core.adventure;
    expect(core.npcs).toBe(npcsA);
    expect(core.adventure).toBe(stateA);

    run(core, 1);
    expect(core.npcs).not.toBe(npcsA);
  });
});
