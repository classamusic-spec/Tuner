# World and story

## Implementation status

This document describes the world as designed. What is **authored in content today** is the
Fallen Sanctuary, the Fractured Garden, the full guardian roster, the World Lattice and the
narrative fragments. The other six regions exist as lattice entries and guardian definitions, not
as playable space. `docs/EVIDENCE.md` is the authority on what has been built and verified.

## The premise

The universe has a natural harmonic foundation: **432 Hz**. Every planet, organism, sacred
structure, body of water and star was formed in relationship with it. It is not a tuning
convention — it is the frequency the world is *made of*, and everything that grew here grew in
agreement with it.

An alien resonance virus has entered the world. It spreads through sound, geometry, architecture,
electromagnetic signal, living tissue, memory, dream, fear, and — most efficiently — through
repetition. Anything that repeats can carry it.

The virus does not destroy. It **detunes**. An infected region drifts from 432 Hz toward an
artificial **440 Hz**: close enough to still pass for music, wrong enough to unmake a world. Stone
that held its shape for millennia begins to repeat incorrectly. Water forgets which way to run.
Creatures that sang in relationship with each other start singing in unison instead.

Creatures called **the Detuners** are spreading and amplifying it. They are not soldiers of
anything. They are what the virus builds when it has enough matter to work with — angular
obsidian-and-violet crystal, glowing violet cores, single luminous eyes, grown into a place rather
than built for it.

## The Tuner

The player is **the Tuner**: a musician and frequency-sensitive traveller who can still hear the
original **World Chord** beneath the interference. That is the whole of their advantage. They are
not stronger than what is out there. They can hear what it used to be.

They carry the **Auralith** — a sacred transforming instrument. A floating circular resonator ring
that orbits the forearm, strung with luminous harmonic strings, framed by rotating geometric
plates. It is played, not aimed. Freeing a guardian recovers a Frequency Core, and the Auralith
learns to hold that frequency as a new ability.

## The shape of the journey

Eight regions, each seized and turned into a 440 Hz amplifier. Each holds a temple that teaches an
ability, and a guardian that was something else before the virus reached it.

| Region | Temple | Ability | Guardian |
| --- | --- | --- | --- |
| The Fractured Garden | Temple of the First Breath | **Echo Pulse** | Oru |
| The Glass Meridian | Meridian Engine | **Mirror Tone** | The Prism Conductor |
| The Tidal Archive | Archive Beneath | **Resonance Thread** | The Mnemonic Ray |
| The Ember Observatory | Clock of Fire | **Pulse Step** | The Red Amplifier |
| The Hollow Choir | Cathedral of Returning Voices | **Split Chord** | The Many-Mouthed Conductor |
| The Verdant Machine | Seed Engine | **Bloom Wave** | The Root Parasite |
| The Desert of Lost Notes | Buried Resonator | **Silence Field** | The Sound Eater |
| The Celestial Loom | — | **World Chord** | The First Conductor |

That table is generated from `ABILITY_SOURCES` in `adventure-types.ts`, so the document cannot
drift from the code.

**Resonance Sight** is not earned. The Tuner has it from the beginning: the ability to look at a
place and see its frequencies — hidden paths, alien weak points, buried melodies, natural 432 Hz
anchors, and the sources of the 440 Hz infection.

## Guardians are freed, not killed

This is the story's load-bearing claim, and the code honours it rather than leaving it to
dialogue.

Every regional guardian was a protector before the virus reached it. **Oru** held the Fractured
Garden together for centuries by repeating one phrase, until an alien Amplifier was driven into
its back and the phrase became a broadcast. The fight is not a fight to the death. At zero health
the guardian enters a **retuning sequence**: the player plays back a series of harmonic degrees,
the Amplifier is separated, and Oru is returned.

The same applies downward. Corrupted wildlife is `cleansable` — at zero health it passes through a
visible restoration beat, violet draining to green, and is restored. The world is sick, not evil.

## Restoration

Freeing a guardian drives the region's infection to zero, and the region *changes*. Not a colour
filter over the same place — geometry, lighting, materials, water, vegetation, sky, particles,
music, wildlife, NPC behaviour, traversal routes and interactive objects all read the same
infection value. Alien growth dissolves, water runs again, roots reconnect what they had been
strangling, the sky recovers its constellations, and the score retunes from 440 Hz to 432 Hz.

Geometry flagged `onlyWhenRestored` appears and `hiddenWhenRestored` disappears, so restoration
opens routes that were genuinely not there before.

## The people

The world has survivors, not a population. Villages are small, camps are smaller, and most of
what happened here is told by what is left rather than by anyone explaining it.

**Sava** is the first person the player meets, in the Fractured Garden. She was there before the
infection and has been keeping one small part of the garden alive by hand — not heroically, just
stubbornly. She establishes the premise through what she has lost.

**The Sanctuary keeper** guides the player from the Harmonic Sanctuary, the one place already at
432 Hz, and the hub that visibly expands as the world is restored.

## The antagonists

**The First Conductor** is what the virus becomes when it has had long enough to organise. Not a
mind exactly — a structure that has learned to want continuation.

**The Silent Choir** is what it is building: every infected voice brought into unison, so that
nothing in the world disagrees with anything else ever again. That is the horror of it. It is not
trying to cause pain. It is trying to end disagreement, and a world in perfect unison is a world
with one voice and no music.

## The ending

The **Celestial Loom** is the alien resonance network above the world, where every learned ability
is required and gravity and geometry stop being reliable.

The finale is not a duel. It is a **planetary retuning ceremony**: every restored region joins a
global symphony, and the accumulated 432 Hz of a whole world overpowers the artificial signal. The
player does not win by being stronger than the First Conductor. They win by having spent the entire
game giving the world back enough voices to drown it out.

## Writing rules

- Original throughout. No terminology, creature, item, structure or story element borrowed from
  any existing game.
- Restraint over exposition. A few lines per scene. The world explains itself through what the
  player finds.
- Every line is text first. There is no recorded voice, and the game must be fully understandable
  muted — so subtitles are the primary channel, not a caption on top of one.
- Nothing important is said only once, and nothing important is said only in audio.
