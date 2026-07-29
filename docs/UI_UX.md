# UI and UX

## Principles

**The exploration HUD is minimal.** During normal play the player should be looking at the
world, not at the corners. Coherence, the equipped form and the charge ring are all that stay
on screen; everything else appears when it is relevant and leaves when it is not.

**Every screen works with keyboard, gamepad and touch.** Not "supports" — *works*. Every
interactive element is reachable, has a visible focus state and an accessible name. A menu that
requires a mouse is a broken menu on three of four platforms.

**Colour is never the only channel.** Every semantically-coloured token also carries a shape key
when `colourblindSafeIcons` is on, asserted programmatically over the whole token set.

**No image assets.** Every icon is inline SVG built in code, which keeps the interface crisp at
any density and lets it recolour with the equipped form or the region's infection.

## Visual language

Dark navy panels, gold outlines, cyan for natural resonance, violet for infection, green for
restoration. Circular tuning rings are the signature shape — Coherence is a ring, not a
rectangular bar, because the game is about frequency and a ring reads as one.

Large typography, minimal ornamentation, strong contrast, simple geometric icons.

## Screens

Title, New Journey, Continue, save slots, Sanctuary, World Lattice, stage information,
exploration HUD, boss HUD, ability selection, pause, settings, accessibility, upgrades, codex,
bestiary, Composition Mode, stage results, challenge menu, credits.

**The World Lattice** deserves specific comment. It is a celestial map built from planetary
frequency lines, constellations, sacred geometry, floating world fragments, musical notation and
animated resonance rings. It shows each region's infection level, the Commander's silhouette,
the recovered frequency, known collectibles, best rank, hidden-route indicators once discovered,
and suggested Resonance Forms — *suggested*, with no requirement implied and no rigid order
enforced. It is deliberately not a grid of boss portraits.

**Composition Mode** is playable, not decorative. Collected Lost Motifs can be arranged and
played back on a step grid. The collectible is worth finding because it gives you something to
do with it.

## HUD

- **Coherence** — a tuning ring. Below 30%, screen-edge interference and an unstable ring, with
  the score detuning toward 440 Hz. Urgent, but never covering information the player needs, and
  honouring `reducedFlashing`.
- **Charge** — a ring closing on the Auralith, with a distinct step at each tier. This is the
  visual half of the charge cue's accessibility pairing.
- **Form** — current form and a radial quick-switch reachable by number keys, shoulder buttons
  or thumb.
- **Boss bar** — with phase pips, so escalation is legible before it happens.
- **Objective, notifications, subtitles** — transient, and always mirrored as text.

## Touch

Designed for touch, not ported to it.

The movement stick has a **floating origin**: it appears wherever the thumb lands in the left
half of the screen rather than sitting at a fixed spot the player must find. The right half is
camera drag. Buttons for jump, dash, fire (hold to charge), counter and quick form switch.

Multi-touch is real: moving, looking and pressing a button simultaneously all work, tracked by
touch identifier. Controls are movable, resizable, opacity-adjustable, and a left-handed mode
mirrors the entire layout.

`packages/ui/src/touch/layout.ts` is the single source of truth for control geometry, and
`@tuner/input`'s touch source reads from the same maths that draws it — so what the player sees
and what the game reads can never drift apart.

Its tests assert, at phone-portrait, phone-landscape, tablet and desktop sizes: no control
overlaps another, none intrudes into safe-area insets, every control meets the minimum touch
target at 0.75× and 1.5× scale, left-handed mode mirrors every control about the centre, and a
control dragged off-screen is clamped back into view.

## Input prompts

Prompts follow `InputFrame.lastDevice`, which switches only on meaningful input — stick drift
must never flip a keyboard player's prompts to a controller glyph.

## Settings

Graphics tier, resolution scale, frame-rate cap, six independent audio levels, sensitivity and
invert per axis, deadzone, hold-vs-toggle for charge and sprint, full keyboard and gamepad
rebinding **with conflict detection**, touch layout options, and difficulty.

Difficulty descriptions say plainly what changes — damage, pattern complexity, counter timing,
recovery, checkpoint generosity — and say plainly what does not: enemy health.

## Accessibility

Every option in `AccessibilityConfig`, grouped, each with a plain-language explanation and a
live preview where meaningful. See `ACCESSIBILITY.md` for the full list and for the paired-cue
rule that underpins it.

## Pause

Reachable at any time, including mid-combat and mid-cutscene. Resume, Restart from Checkpoint,
Settings, Accessibility, Return to Sanctuary, Quit. Every cutscene is skippable.

## Implementation status

**Built and reachable:** title, pause, settings, accessibility, credits, results, the HUD
(Coherence ring, charge ring, form, boss bar with phase pips, objective, notifications,
subtitles), and the touch overlay.

**Designed but not built:** save slots, the World Lattice, stage information, Sanctuary, codex,
bestiary, upgrades, Composition Mode and the challenge menu. The data behind several of them
exists — `WORLD_LATTICE`, `KEEPER_MEMORIES`, `LOST_MOTIFS`, the bestiary entries and the save
schema are all authored and tested — but the screens that would drive them were not written. The
save-slots entry point in the build says so on screen rather than pretending.

**Written but untested:** the store, theme and primitives have no test file yet.

## What verification will need to cover

When written, the store and theme tests should assert: the navigation stack pushes and pops correctly and "back" from
the root is a safe no-op; settings persist and notify subscribers; the notification queue
expires and caps; `textScale` scales the type ramp proportionally; `highContrast` measurably
raises the computed WCAG contrast ratio and the high-contrast pairing meets at least 4.5:1; and
`colourblindSafeIcons` guarantees a shape key on every colour-coded token.

The touch-layout assertions in that list **are** written and passing, in
`packages/input/src/touch.test.ts` — 21 tests covering overlap, safe areas, minimum touch size at
three scales, left-handed mirroring, hit testing, override clamping and stick vectors.
