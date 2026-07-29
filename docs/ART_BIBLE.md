# Art bible

## The one-line brief

Simplified vector-inspired cartoon, translated into lightweight 3D. Bold, clean, colourful, and
readable at arm's length on a phone.

## Why this style

It is not a compromise. It is the right answer for this game for three reasons:

1. **Readability is a mechanic.** A 3D platformer lives or dies on whether the player can judge
   a gap, a landing and an incoming attack instantly. Flat colours and strong silhouettes make
   that judgement fast; surface detail makes it slow.
2. **Everything is procedural.** There are no model or texture assets — characters, creatures,
   stages and effects are all built from primitives in code. That keeps the download small,
   guarantees stylistic consistency, and lets colours shift with the equipped Resonance Form or
   with a region's infection level, which would be impossible with baked textures.
3. **It scales down honestly.** A stylised look degrades gracefully on a low tier; a
   photorealistic one falls apart.

## Colour language

Colour carries meaning consistently across world, UI, VFX and audio visualisation:

| Colour | Meaning | Token |
| --- | --- | --- |
| Deep navy | ground, structure, the world's substance | `abyss`, `panel` |
| Gold | sacred geometry, the Tuner's own signal, interface outlines | `gold` |
| Cyan | natural 432 Hz resonance — health, truth, the World Chord | `resonance` |
| Violet | the 440 Hz infection — the Detuners, corruption, wrongness | `infection` |
| Green | restoration — life returning, a region freed | `restore` |
| Warm red | damage and urgency, used sparingly | `alarm` |

**Colour is never the only channel.** Every mechanic that reads as colour also reads as shape,
fill progress or position. That is an accessibility requirement, and it is asserted in the UI
test suite rather than left to discipline.

## Rules

**Do**
- Flat or lightly layered colour. Two or three tones per surface.
- Strong, distinct silhouettes. Every creature should be identifiable as a black shape.
- Clean geometric outlines via a cheap rim treatment, not a full outline post-pass.
- Low-to-medium poly. Big readable forms, not dense detail.
- Sacred geometry as the visual grammar: rings, polygons, harmonic lattices, interlocking
  circles.
- Large landmarks the player can navigate by.
- Controlled lighting: one key, one ambient, one resonance fill.

**Don't**
- Photorealistic texture, surface noise, or grime.
- Muddy or desaturated colour. Every hue should be deliberate.
- Heavy bloom, constant particle noise, or screen-filling effects that hide the ground.
- Complex shaders. A cheap procedural band beats an expensive noise field.
- Generic sci-fi panels or generic fantasy ruins. Every prop belongs to *this* world.
- Mixed asset styles. One vocabulary, everywhere.

## The Tuner

A young musician-adventurer. Light build, voluminous curly light-brown hair — the hair is the
silhouette's signature and should read at any distance.

Costume: a deep indigo tunic; a violet sash draped diagonally across the chest; a gold emblem of
two interlocking rings at the shoulder; a wrapped waist sash; an asymmetric layered skirt-wrap
falling to one side; a gold tassel cluster at the hip; violet leggings; navy fingerless gloves;
soft pointed violet boots.

Expressive face with large readable eyes. Readable hands and feet — they carry a lot of the
animation. Accent colours shift with the equipped Resonance Form, so the player can see at a
glance what they are holding.

The character must stay legible at mobile scale. If a detail vanishes at 200 px tall, it does
not belong.

## The Auralith

An original sacred instrument, and explicitly **not** an arm cannon.

A floating circular resonator ring that orbits the forearm, strung with luminous harmonic
strings across its opening, framed by rotating geometric plates. It reads as something played,
not something aimed.

It must do three things visually:
- **Reconfigure per form** — plate count, ring geometry, string count and colour all change.
- **Show charge** — the strings brighten and the plates spin faster as each tier is reached.
  This is the visual half of the charge cue's accessibility pairing.
- **Stay out of the way** — it never occludes the landing zone.

## The Detuners

Angular obsidian-and-violet crystalline creatures. Glowing violet cores, single luminous eyes.
They should look *wrong* against the world's warm stone and gold — grown into a place rather
than built for it.

| Family | Read | Role |
| --- | --- | --- |
| Whisperers | small, low, skittering shards | scouts |
| Drifters | dart-shaped, bladed fins, airborne | flyers |
| Fractures | heavy, plated, glowing core | shield brutes |
| Amplifiers | squat pylons, rotating emitter | turrets |
| Conductors | robed, crystal-topped stave | command units |
| Elite beasts | large, layered, unmistakable | rare threats |

**Cleansing is not killing.** Corrupted wildlife and guardians dissolve violet into green and
are restored. The effect must read as relief, not destruction — it is a story point, and the
code and the VFX both honour it.

## Regions

Each stage is a place the Detuners have converted into a 440 Hz amplifier, and its restored
state must feel like the room stopped ringing.

| Region | Infected | Restored |
| --- | --- | --- |
| Fallen Sanctuary | collapsing gold and stone, violet fracture lines | whole, lit, singing |
| Fractured Garden | violet vines strangling luminous roots, dry channels | water flowing, roots reconnected, constellations returned |
| Glass Meridian | forced synchronisation, violet through every facet | crystal ringing in tune |
| Tidal Archive | drowned halls, corrupted coral machinery | memories legible again |
| Ember Observatory | orreries spinning too fast, lava | stars watched, not burned |
| Hollow Choir | mouths carved in stone, one forced signal | many voices, distinct |
| Verdant Machine | plants made into antennas | jungle and machine at peace |
| Desert of Lost Notes | sound eaten, instruments buried | the dunes ring again |

Restoration is implemented as one parameter. Materials, lighting, sky and the score all read the
region's infection level, so a Commander falling transforms everything at once rather than in
pieces.

## Animation

Procedural, from pure functions of gameplay state — no clips, no files.

The invariant, asserted in tests: **animation follows gameplay state and never gates it.** A
state change is reflected in the target pose on the same call. Nothing about the way the
character looks is allowed to make the controls feel late.

Secondary motion — hair, sash, the Auralith trailing the forearm — is damped-spring driven and
framerate independent. Upper-body firing and charging poses layer over locomotion, so the Tuner
can fire while running, jumping and dashing.

## VFX

Effects speak the sacred-geometry language: rings, polygons, harmonic lattices. Not sparks and
smoke.

Every effect is pooled and instanced, budgeted by graphics tier, and respects `reducedParticles`
and `reducedFlashing`. The telegraph layer — ground-projected timing rings and attack-shape
previews — is treated as **gameplay, not decoration**: it is what makes the game playable with
the sound off.
