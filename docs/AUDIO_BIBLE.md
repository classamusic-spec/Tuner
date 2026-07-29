# Audio bible

## Audio is the subject, not the decoration

TUNER is a game about frequency. The score does not merely accompany the restoration of a
region — **it is the restoration.** As a region's infection falls, the music literally retunes
from 440 Hz to 432 Hz, and the player hears the world come back into agreement with itself.

That idea only works if it is real, so it is implemented as an actual frequency ratio derived
from the region's infection level, asserted in tests: infection 1 maps to 440 Hz, infection 0
maps to 432 Hz, monotonically in between.

## Everything is synthesised

There are no audio files. Sounds are described as data (`SfxRecipe`: oscillator type, frequency
envelope, ADSR, filter sweep, noise amount, duration) and rendered through Web Audio.

This is the right choice here for three reasons: the download stays tiny; a game about pitch can
generate any pitch it needs rather than resampling a recording; and the whole score can be
retuned by changing one number, which a library of baked audio files could never do.

Player pitches derive from `harmonicHz()` — just intonation against 432 Hz. Detuner sounds are
deliberately detuned toward 440 Hz and use harsher waveforms. The dissonance the player hears
around the enemies is the same number the shader uses to tint them violet.

## Adaptive layers

The music director takes gameplay signals — stage, phase, combat pressure, boss presence,
Coherence fraction, restoration progress — and produces per-layer target gains, eased over time
rather than snapped, with framerate-independent crossfades.

| Layer | Engages |
| --- | --- |
| `world` | always — the region's natural resonance |
| `movement` | rises with player speed |
| `combat` | rises with nearby active enemies |
| `miniboss` / `commander` | replace combat during those phases |
| `lowCoherence` | below the Coherence threshold |
| `restoration` | during the restoration phase |
| `sanctuary` | in the hub — the one place already at 432 Hz |
| `worldChord` | the finale |

Each stage's motif is generated deterministically from a seed, so every region has its own theme
without shipping a single audio asset.

## Per-form sound families

Every Resonance Form has a distinct pitch offset, waveform and filter character, so the player
can hear which form is equipped without looking. Asserted distinct in tests, alongside the
requirement that no two forms share a colour, icon or silhouette.

Each form needs a projectile sound, a charge sound, an impact sound, a movement sound, a puzzle
response and a boss-interaction sound.

## Comfort

Pure tones are the whole vocabulary here, and sustained pure tones are fatiguing. Recipes are
held under an exported amplitude ceiling and pure-tone sustains are duration-capped — both
asserted in tests rather than left to judgement.

Six independent level buses: master, music, sfx, ui, voice, ambience.

## The rule that outranks everything above

**Every gameplay-critical audio cue has a visual equivalent, and the critical path is completable
with the sound off.**

This is enforced structurally, not by review. The simulation never calls the audio engine — it
emits a `GameEvents` event, and audio and rendering both subscribe. Because they listen to the
*same* event, a cue cannot exist without the data a visual needs; the payload carries position,
normal, timing and intensity precisely so the renderer can act on it.

The consequence for sound design is worth stating directly: **no mechanic may be announced by
audio alone.** Rhythm-based hazards are the sharpest case, which is why `visualRhythmCues` is on
by default rather than being an opt-in accessibility extra. See `ACCESSIBILITY.md` for the full
cue-pairing table.

## Robustness

`createWebAudioEngine()` never throws. If `AudioContext` is unavailable, or the browser blocks
it, or the device has no output, the factory returns a working object that silently does
nothing. A null adapter serves tests and headless builds.

The game must remain fully playable when audio fails — and since the visual pairing is already
guaranteed, it does.

Mobile lifecycle is handled: audio suspends on background and resumes on return, and the
context is unlocked only from a real user gesture, as browsers require.


## Implementation status

**This document describes the design. Not all of it is built.** Read
`docs/EVIDENCE.md` for what was actually run. The split, stated plainly:

- **Built:** the `AudioEngine` contract and a working null adapter, so the game runs silently
  without special-casing.
- **Not built:** the Web Audio engine, `SFX_RECIPES`, the per-form sound families, the adaptive
  music director, and the 432↔440 retuning described above. The specialist assigned to it never
  ran — the session hit its usage limit first.

The game is therefore **silent today.** It remains fully playable, and that is not luck: because
the simulation only ever emits `GameEvents` and the renderer already draws the visual half of
every cue, silence costs nothing but atmosphere.

Nothing in this document has been verified. When the engine is written, the assertions below are
what it owes.

## What verification will need to cover

When implemented, assert: every `SfxId` has a recipe; no recipe exceeds the amplitude ceiling; no pure-tone
recipe sustains past the documented limit; form sound families are distinct; each gameplay
situation produces the expected dominant music layer; crossfades ease rather than snap and are
framerate independent; the infection→frequency mapping is exact at both ends and monotonic
between; generated phrases are deterministic for a fixed seed and stay in scale; and
`createWebAudioEngine()` does not throw when Web Audio is absent.

None of these run yet.
