# Combat system

## The Auralith

The Tuner's instrument is a floating circular resonator ring that orbits the forearm, strung
with luminous harmonic strings and framed by rotating geometric plates. It is played, not aimed.

Everything it does is available from the first stage, and everything works while moving,
jumping and dashing. Combat that stops movement would undo the controller.

## Coherence, not health

The player's resource is Coherence: how well they are still holding the World Chord against the
interference. It runs 0–100 by default and is raised permanently by Coherence Fragments.

Below 30% the presentation degrades — screen-edge interference, the score detuning toward
440 Hz, unstable sacred geometry in the HUD. **The controls never degrade.** Low Coherence has
to feel urgent, but a player must always be able to fight their way back. Restoration comes from
pickups, safe resonance zones, successful counters, cleansing enemies, some forms, and
checkpoints.

## Actions

### Resonance Pulse

Fast, accurate, cheap. 10 damage, 46 m/s, one every 0.14 s. Low recovery, no wind-up, no
grounding requirement. It is the verb the player uses thousands of times, so it is the one that
must feel best.

### Charged Chord

Holding fire crosses three tiers at 0.34 s, 0.78 s and 1.35 s, dealing 26 / 52 / 92. Each tier
is announced by a rising harmonic **and** by a ring closing on the Auralith with the strings
brightening — the paired cue, so charge state is readable with sound off.

Charged shots carry the `charge` damage kind, which is what breaks reinforced virus armour. That
gives armour a purpose beyond making things take longer: it is a prompt to use the whole kit.

### Harmonic Burst

A short-range radial push on a 1.1 s cooldown. 14 damage, 3.6 m radius, 13 m/s knockback. It
interrupts certain attacks, creates breathing room, and strikes nearby resonators — which is why
it is a puzzle tool as much as a combat one.

### Lock-On

Optional, and deliberately unobtrusive. It picks the nearest valid enemy within 26 m and a 55°
cone and biases aim toward it; it never takes control. It releases after 1.2 s of the target
being gone. With lock-on off and aim assist at zero, aim is *exactly* the camera direction —
asserted in tests, because "aim assist that cannot be turned off" is a real complaint about
real games.

### Resonance Counter

The skill expression of the kit. Pressing counter opens a 0.22 s window (widened by Story and
Explorer, narrowed by Resonance Master). An incoming counterable enemy projectile caught in that
window is **converted** — it becomes a player projectile travelling back at whoever fired it —
and restores 8 Coherence.

It is communicated four ways at once: sound, the shape of the incoming shot, the rhythm of the
enemy's telegraph, and a ring around the Tuner that lasts exactly as long as the window. It has
to remain readable when muted, so none of those four is load-bearing alone.

Counter accuracy feeds the stage rank, which is what makes it worth practising rather than
ignoring.

## Damage channels

`pulse`, `charge`, `burst`, `counter`, `hazard`, `form`.

Armoured enemies list which channels get through — usually `charge` and `counter`, both base
Auralith verbs. **Armour is never a form gate.** A player who has not found a particular
Resonance Form can still break everything in the game.

Form advantages multiply damage against specific bosses. They change how a fight goes; they
never decide whether it can be won. The boss suite asserts that a base-form damage loop still
reduces every Commander to zero.

## Feedback

Impact is built from four layers, each cheap on its own:

1. **Hit-stop** — ~45 ms of heavily slowed simulation, scaled by hit strength. Slowed, not
   frozen: freezing reads as dropped input, slowing reads as weight.
2. **Screen shake** — magnitude scaled by `CameraConfig.shakeScale` and then by the
   accessibility setting, so a player who needs it off gets it off.
3. **VFX** — sacred-geometry impact rings, deflect sparks on blocked hits, violet-to-green
   dissolve on a cleanse.
4. **Audio** — per-form sound families, tuned in just intonation against 432 Hz.

Every one of these is driven by a `GameEvents` emission, so nothing in the simulation knows or
cares whether a renderer is attached.

## Difficulty

Difficulty scales incoming damage, enemy attack cadence, the counter window, recovery resources
and checkpoint generosity.

It does **not** scale enemy or boss health. Inflating health makes a fight longer, not
different, and a player who wants an easier game is badly served by a longer one.

## Verification

Asserted in the combat suite: fire cadence respects `pulseInterval`; charge tiers land at their
configured times and damages; a charged shot breaks armour a pulse cannot; burst damages
everything inside its radius and nothing outside; a counterable shot inside the window is
converted and heads back toward its sender; a counter outside the window does not convert;
`damagePlayer` is a no-op during invulnerability and scales with difficulty; lock-on selects the
nearest in-cone target and releases on the break timer; aim assist at zero yields exactly the
camera direction; the projectile cap retires the oldest shot rather than dropping new ones.
