# Accessibility

Accessibility in TUNER is a design constraint, not a settings menu bolted on at the end. The
game's subject is sound, which makes one guarantee non-negotiable:

> **The critical path must be completable with the sound off.**

Everything below follows from that.

## The paired-cue rule

Every gameplay-critical audio cue has a visual equivalent, and the mechanism that enforces it is
structural rather than procedural.

`@tuner/game-core` never calls the audio engine directly. It emits a `GameEvents` event. Audio
subscribes and plays a cue; rendering subscribes and draws something. Because both listen to the
*same* event, a cue cannot exist without the information a visual needs — the event payload
carries position, normal, timing and intensity precisely so the renderer can act on it.

Concretely:

| Cue | Sound | Visual equivalent |
| --- | --- | --- |
| Enemy telegraph | wind-up tone | ground-projected timing ring that fills as the wind-up runs down, plus an attack-shape preview |
| Boss telegraph | phase-specific motif | same ring, plus the attack's area drawn on the arena floor |
| Charge tier reached | rising harmonic | a new ring closes on the Auralith; the strings brighten |
| Counter window open | short chime | a ring flashes around the Tuner for the exact duration of the window |
| Resonator struck | the resonator's pitch | a ring at the resonator, sized and coloured by its harmonic degree |
| Puzzle solved / failed | resolution / dissonance | the mechanism visibly opens, or the sequence visibly resets |
| Low Coherence | audio detunes toward 440 Hz | interference at the screen edges and an unstable tuning ring |
| Beat / rhythm hazards | the region's pulse | a beat indicator synced to `world.stage.beatPhase` |
| Restoration | the score retunes to 432 Hz | violet drains to green across every surface at once |

Rhythm-based hazards are the sharpest case. `visualRhythmCues` is **on by default**, not opt-in,
because a hazard that only announces itself in audio is not a hazard a deaf player can learn.

## Colour is never the only channel

Cyan means natural resonance, violet means infection, green means restoration — but no mechanic
depends on distinguishing them. Telegraph rings carry their information in *fill progress and
shape*, not hue. `colourblindSafeIcons` additionally guarantees that every semantically-coloured
UI token carries a shape key; the UI test suite asserts this programmatically across the whole
token set rather than trusting it.

## Options

All of these live in `AccessibilityConfig` (`packages/game-core/src/config.ts`) and are honoured
by the simulation, not just stored.

**Reading and seeing**
- Subtitles for all dialogue, with speaker names
- Text scaling
- High contrast (asserted to reach at least 4.5:1 on the primary pairing)
- Colour-blind-safe icons
- Pitch visualisation, showing what a frequency *is* rather than only sounding it

**Motion and comfort**
- Reduced camera motion — disables speed FOV boost, zeroes shake, softens rotation clamps
- Reduced flashing
- Reduced particles
- Screen-shake scale, independent of reduced motion
- Haptics on/off

**Input**
- Full keyboard, mouse, gamepad and touch remapping with conflict detection
- Hold-vs-toggle for charge and sprint
- Adjustable stick deadzone and look sensitivity, per axis, with invert
- Left-handed touch layout that mirrors the entire control surface
- Movable, resizable, opacity-adjustable touch controls

**Assists**
- Aim assist and lock-on assist, each on a 0–1 scale (0 is exactly a no-op — asserted in tests)
- Platforming assistance: mid-air correction toward the intended landing platform
- Coyote-time adjustment on top of the base window
- Fall-recovery assistance: returns the player to safe ground at no Coherence cost
- Generous checkpoints

**Difficulty** — Story, Explorer, Standard, Resonance Master. Difficulty changes incoming
damage, pattern complexity, counter window, recovery resources and checkpoint generosity. It
deliberately **does not** change enemy health: inflating health makes a fight longer, not
different, and a player who needs an easier game is poorly served by a longer one.

**Always available**
- Pause at any time, including mid-combat and mid-cutscene
- Every cutscene skippable

## Things the game will not do

- It will not impair controls at low Coherence beyond readability effects. Low Coherence must
  feel urgent, but a player must always be able to recover.
- It will not gate progress behind a rank. Ranks encourage replay; they never block the story.
- It will not require a specific Resonance Form to beat a Commander. Forms give advantages;
  the base Auralith can win every fight. That is asserted in the boss test suite.

## Verification

Assertions currently in the test suite:

- `aimAssist = 0` with no lock-on produces exactly the raw camera direction
- `landingAssist = 0` is a no-op on the movement path
- `reducedMotion` zeroes FOV boost and shake
- `highContrast` measurably raises the computed WCAG contrast ratio
- `colourblindSafeIcons` guarantees a shape key on every colour-coded token
- Touch layout: no control overlaps, none intrudes on safe-area insets, all meet the minimum
  touch target at every tested viewport and scale
- Left-handed mode mirrors every control about the viewport centre

Not built, and therefore not verified:

- **The particle system.** `reducedParticles` is stored and passed through, but there is no
  particle system for it to reduce yet.
- **Audio.** The engine was never written, so the audio side of every paired cue is silent. The
  visual side is built and is what makes the game playable — which is the guarantee that
  mattered, but the pairing is currently one-sided by omission rather than by design.

Also not verified, and stated as such: no play-testing with assistive technology, no screen
reader pass over the menus, and no verification with players who have the impairments these
options exist to serve. Those are the checks that would actually validate this work, and they
have not been done.
