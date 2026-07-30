# Character bible

## Implementation status

**Built:** the Tuner and the Auralith, both procedurally modelled in
`packages/rendering/src/character/`. Their poses come from `animation.ts`, which is pure and
tested. **Authored in content:** Sava and the Fractured Garden inhabitants. **Designed only:** the
Sanctuary keeper's model, the First Conductor and the Silent Choir.

Nothing in this project uses model assets. Every character is built from Three.js primitives in
code, which keeps the download small, holds one style across the whole cast, and lets accent
colours shift with the equipped ability — something baked textures could not do.

---

## The Tuner

A young musician-adventurer. Frequency-sensitive, travelling, and carrying an instrument rather
than a weapon.

### Silhouette

Light build. **Voluminous curly light-brown hair** — this is the signature and must read at any
distance, so it is built from a cluster of overlapping spheres rather than anything clever. If you
can identify the character as a black shape at 200 px tall, the silhouette is working.

### Costume

Taken from the actual build in `character/tuner.tsx`:

- Deep indigo tunic
- A violet sash drawn diagonally across the chest
- A **gold emblem of two interlocking rings** at the shoulder — the Tuner's mark, and the game's
  logo
- A wrapped waist sash
- An asymmetric layered skirt-wrap falling to one side
- A gold tassel cluster at the hip
- Violet leggings
- Navy fingerless gloves
- Soft pointed violet boots

Large, readable eyes. Readable hands and feet — they carry most of the animation's expression.

### Colour and ability

Accent colours shift with the equipped ability, so the player can see what they are holding without
checking the HUD. The base costume stays constant; the accents, the Auralith's strings and its core
glow all take the ability's colour.

### Reading at mobile scale

The hard rule: **if a detail vanishes at 200 px tall, it does not belong.** No fine trim, no small
pattern, no thin lines that alias away. The costume is built from a handful of bold shapes for
exactly this reason.

### Animation

Procedural, from pure functions of gameplay state — no clips, no files. The invariant, asserted in
tests: **animation follows gameplay state and never gates it.** A state change is reflected in the
target pose on the same call, with no lock-out, so nothing about how the character looks can make
the controls feel late.

Secondary motion — hair, sash, and the Auralith trailing the forearm — runs on damped springs and
is framerate independent. Firing, charging and counter poses layer over locomotion as an upper-body
override, so the Tuner can play while running, jumping and dashing.

Idle is a gentle musical sway. That matters: the character should look like someone who hears
something the player cannot.

---

## The Auralith

An original sacred instrument, and explicitly **not a weapon**. Nothing about its silhouette points
forward.

A floating circular resonator ring that orbits the forearm, strung with luminous harmonic strings
across its opening, framed by rotating geometric plates. It reads as something *played*.

It has three jobs beyond looking right:

1. **Reconfigure per ability.** Plate count, ring proportions, string count and colour all change.
   Each of the nine has a distinct silhouette key, so the instrument tells you which frequency you
   are holding.
2. **Show charge.** The strings brighten and the plates spin faster as each tier lands. This is the
   visual half of the charge cue's accessibility pairing — charge state must be readable with sound
   off.
3. **Stay out of the way.** It must never occlude the ground the player is about to land on.

At rest it still turns slowly. It is an instrument, not a prop bolted to an arm.

---

## Sava

The first person the player meets, in the Fractured Garden.

She was here before the infection. She has been keeping one small part of the garden alive by hand
— not heroically, just stubbornly, because it was hers and she could still reach it. She knows the
garden better than the Tuner ever will and is not impressed by frequency-sensitivity.

Her first conversation establishes the premise **through what she has lost**, not through
exposition. She does not explain 432 Hz. She describes what the water used to sound like.

She changes visibly after the region is restored — a different appearance and a different set of
lines. That is authored through `restoredAppearance` and `restoredDialogue` on `NpcDef`, so the
change is data rather than a special case.

**Design note:** she must not read as a quest dispenser. If her dialogue could be replaced by a
signpost without loss, it is written wrong.

---

## The Sanctuary keeper

Guides the player from the Harmonic Sanctuary — the one place in the world already at 432 Hz, and
the hub that visibly expands as regions are restored.

Speaks plainly and briefly. Knows more than they say, and says the useful part.

---

## The antagonists

### The First Conductor

What the virus becomes when it has had long enough to organise. Not a mind exactly — a structure
that has learned to want continuation. Should read as *architecture that is paying attention*.

### The Silent Choir

What it is building: every infected voice brought into unison so that nothing in the world
disagrees with anything else again.

This is the horror, and it should be designed as such — not as menace but as **terrible calm**. A
world in perfect unison is a world with one voice and no music.

---

## Casting rules for new characters

- Survivors, not a population. Any crowd should feel like people who stayed.
- Everyone wants something small and concrete. Nobody exists to deliver lore.
- Every character must have a restored state, because the world changing is the point.
- One bold silhouette each. If two characters read the same as black shapes, one of them is wrong.
- Original throughout — no character may echo an existing game's cast in design, name or role.
