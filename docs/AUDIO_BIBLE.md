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

**Built and wired.** An earlier revision of this section said the engine did not exist and the
game was silent. That was true when it was written and is no longer true; it is corrected here
rather than quietly deleted, because a status section that has been wrong once is worth being
sceptical of.

- **Built:** `SFX_RECIPES` (33 cues), the per-form sound families, `applyFormToRecipe`, the
  adaptive music director with generated per-region motifs, the 432↔440 retuning, and
  `createWebAudioEngine()` — a real Web Audio adapter with a bussed graph, a master limiter,
  positional panning and distance attenuation, look-ahead music scheduling and an analyser feed
  for the accessibility visualiser. The null adapter is still there for tests and headless runs.
- **Wired:** `apps/web/src/game/use-audio-bridge.ts` subscribes 23 `GameEvents` to cues, drives
  the director from the world on a 120 ms timer, moves the listener with the player, unlocks the
  context on the New Journey click and suspends on background. The game is audible in the browser.
- **Verified:** 70 tests in `packages/audio` pass — see the coverage list below.

**What is not verified, stated exactly.** The engine tests run against a *stub* Web Audio graph:
they assert which nodes are created, how parameters are ramped, what is scheduled and when. They
do not prove anything about how the result sounds, because this build environment has no audio
device and nobody has listened to it. Every claim in this document about the *character* of a
sound — that families are "distinguishable by ear", that sustains are comfortable — is enforced
as a structural proxy (pairwise-distinct timbre signatures, amplitude ceilings, duration caps),
not by a listening test. Those proxies can be satisfied by a mix that is still unpleasant. A real
listening pass is outstanding.

**Gaps in the sound design itself:**

- Detuner projectiles reuse the player's `pulse-fire` recipe, voiced in the archetype's form and
  pitched to 440 Hz. It is distinguishable, but there is no dedicated enemy fire cue.
- The `voice` bus exists as a level control with no cues routed to it. There is no recorded or
  synthesised dialogue; dialogue is text and subtitles only.
- The `ambience` bus carries exactly one cue, the low-Coherence warning drone. There are no
  per-region ambient beds.

## What the tests cover

`packages/audio` — 21 assertions in `synth.test.ts`, 49 in `music.test.ts`:

Every `SfxId` has exactly one recipe with a matching `id` and a palette key for its visual half;
no recipe exceeds `MAX_PEAK_AMPLITUDE` with its noise bed included; no pure tone sustains past
`MAX_PURE_TONE_SECONDS` or loops at all; every envelope fits inside its own duration; player
pitches sit on the 432 Hz just-intonation grid and infected cues on the 440 Hz one, detuned by
the same number the shader tints with; the restoration cue glides 440→432; all eight abilities
are pairwise distinct in timbre signature; `FORM_HARMONIC_DEGREES` mirrors the harmonic degree
`RESONANCE_FORMS` assigns in game-core (a pinning test — audio cannot import game-core without
creating a cycle, so the mirror is asserted instead of shared); re-voicing a recipe into a family
does not breach the ceilings; the infection→frequency mapping is exact at both ends and strictly
monotonic between; each gameplay situation produces the expected dominant layer, with boss layers
replacing combat rather than stacking; crossfades ease rather than snap and are framerate
independent (one 30 Hz step equals two 60 Hz steps); phrases are deterministic per seed, stay in
scale and never overlap; and `createWebAudioEngine()` returns a fully callable object that
silently does nothing when `AudioContext` is absent or its construction throws.

Against the stub graph: the bus tree is built and unlocked; the summed master output passes
through a limiter, and still plays on a host with no compressor; `dispose()` is terminal rather
than rebuilding a context behind the caller's back; recipes render as oscillators with real
parameter ramps; sounds pan by listener-relative direction, attenuate with distance and are
dropped entirely beyond the audible radius; music is scheduled ahead of the audio clock rather
than note by note; the score retunes with the infection level; and the music bus comes back after
a `stopMusic` fade rather than resuming into silence.
