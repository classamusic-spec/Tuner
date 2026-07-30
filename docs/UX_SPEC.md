# UX specification

## Implementation status

**Built and reachable today:** boot, title, settings, accessibility, credits, pause, results, the
exploration HUD, and the touch overlay. Verified by 26 Playwright assertions across desktop,
tablet-touch and phone-touch against the production build.

**Designed, with data authored but no screen:** save slots, the world lattice, region map, codex,
bestiary, inventory, ability upgrades, Composition Mode, photo mode, the Sanctuary, region
completion and the final ceremony. Several have their data ready — `WORLD_LATTICE`, `CodexEntryDef`
entries, `MotifCardDef` cards and the save schema all exist and are tested. The save-slots entry
point says so on screen rather than pretending.

`docs/EVIDENCE.md` is the authority. This document marks each screen accordingly.

---

## Principles

**The exploration HUD stays minimal.** During play the player should be looking at the world, not
the corners. Coherence, the equipped ability and the charge ring are all that persist; everything
else appears when relevant and leaves when not.

**Every screen works with keyboard, gamepad and touch.** Not "supports" — *works*. Every
interactive element is reachable, carries a visible focus state and has an accessible name. A menu
that needs a mouse is broken on three of the four platforms this ships on.

**Colour is never the only channel.** Every semantically-coloured token also carries a shape key
when `colourblindSafeIcons` is on, asserted programmatically across the token set.

**No image assets.** Every icon is inline SVG built in code, so the interface stays crisp at any
density and can recolour with the equipped ability or the region's infection.

**Guide through the world, not through markers.** Light, sound, frequency trails, landmarks,
architecture, constellations and tuning towers do the work. The map is a record of where you have
been. An optional navigation assist exists for players who want it, off by default.

## Visual language

Dark navy surfaces, gold lines, cyan frequency trails, violet alien states, green restoration.
Circular tuning rings are the signature shape — Coherence is a **ring, not a bar**, because the game
is about frequency and a ring reads as one. Large clear typography, bold icons, minimal gradients,
flat vector panels, restrained ornamentation, sacred geometry used functionally rather than as
decoration.

## Screens

| Screen | Status | Purpose and behaviour |
| --- | --- | --- |
| Boot | built | Emblem and a status line while the simulation and settings load |
| Title | built | New Journey / Continue / Settings / Accessibility / Credits over a sacred-geometry backdrop |
| Save slots | **not built** | List, create, delete; per-slot playtime and completion. Schema and storage exist |
| Accessibility setup | built | Offered from the title before play, and reachable from pause |
| Settings | built | Difficulty, graphics tier, six audio buses, input, touch layout |
| Exploration HUD | built | See below |
| Resonance Sight | partial | The simulation tracks it; the overlay treatment is not built |
| Ability radial | **not built** | Nine abilities on a ring; number keys, shoulder buttons or thumb |
| Dialogue | **not built** | Speaker, text, SVG portrait, advance prompt, branch choices. Skippable |
| Map | **not built** | Region record drawn from `MapMarkerDef`; discovered markers only |
| Codex / bestiary | **not built** | Categorised entries; locked ones shown as unknown, not hidden |
| Inventory / upgrades | **not built** | Spend Resonance Shards; show what each upgrade changes |
| Puzzle interface | built (in-world) | Resonator rings and beat indicators, drawn in the scene |
| Boss HUD | built | Name, health, phase pips, retuning progress |
| Composition Mode | **not built** | Four layers, found motif cards on a step grid |
| Sanctuary | **not built** | Hub that visibly expands as regions are restored |
| Pause | built | Reachable at **any** time, including mid-cutscene |
| Photo mode | **not built** | Hide HUD, free camera, framing aids |
| Region completion | built (results) | Rank, per-criterion breakdown, ability awarded |
| Final ceremony | **not built** | The planetary retuning |
| Credits | built | Original credits roll |

## The exploration HUD

- **Coherence** — a tuning ring. Below 30%, screen-edge interference and an unstable ring. Urgent,
  but it never covers information the player needs to recover, and it honours `reducedFlashing`.
  **The controls never degrade** — only the presentation does.
- **Charge** — a ring closing on the Auralith with a distinct step at each tier. The visual half of
  the charge cue's accessibility pairing.
- **Ability** — the equipped ability's name, drawn from `ABILITY_NAMES`, never a raw id.
- **Boss bar** — with phase pips, so escalation is legible before it arrives.
- **Objective, notifications, subtitles** — transient, and always text.

### Compact layout

Under **520 px of viewport height** (phone landscape is around 390 px) the HUD switches to a compact
layout: smaller rings, the Coherence word dropped, notifications moved to the left rail, and a
narrower subtitle shifted off-centre.

This exists because of a real defect. The touch-layout tests guarantee controls never overlap *each
other* and said nothing about the HUD landing on top of them — and on phone landscape the tutorial
toast sat over the fire button, the subtitle over lock-on, and "COHERENCE" overflowed its own ring.
Screenshots caught what 441 passing tests had not. The missing assertion class — control-vs-interface
overlap — is still missing and is the next thing to add.

## Touch

Designed for touch, not ported to it.

The movement stick has a **floating origin**: it appears wherever the thumb lands in the left half of
the screen, rather than at a fixed spot the player must find without looking. The right half is
camera drag. Buttons for jump, dash, fire (hold to charge), counter, lock-on and quick ability
switch.

Multi-touch is real — moving, aiming and pressing a button simultaneously all work, tracked by touch
identifier rather than the newest touch winning. Controls are movable, resizable,
opacity-adjustable, and a left-handed mode mirrors the entire surface.

`computeTouchLayout` in `packages/input/src/touch.ts` is the single source of truth. The touch source
reads through it and the UI overlay draws from it, so what the player sees and what the game reads
cannot drift apart — a second copy of the geometry in the renderer is exactly how a jump button
starts "sometimes not working".

**Touch controls only render on devices that actually have a touchscreen.** They previously drew over
the desktop HUD, which was not a harmless extra: it covered information and told a keyboard player
the wrong thing about how to play.

21 assertions cover the layout: no control overlaps another at phone-portrait, phone-landscape,
tablet and desktop sizes; none intrudes into safe-area insets; every control meets the 46 px minimum
at 0.75× and 1.5× scale; left-handed mirrors every control about the centre; a control dragged
off-screen is clamped back.

Portrait may serve map, codex, inventory, composition, settings and Sanctuary management. Gameplay
is landscape-first.

## Input prompts

Prompts follow `InputFrame.lastDevice`, which switches only on **meaningful** input — stick drift must
never flip a keyboard player's prompts to a controller glyph.

## Accessibility

Every option in `AccessibilityConfig`, grouped, each with a plain-language explanation of its effect
and a live preview where meaningful. See `ACCESSIBILITY.md` for the full list and for the paired-cue
rule that underpins it.

Settings are restored **before the title screen paints**, so a player who needs reduced motion or
larger text never sees a frame without it.

## Pause

Reachable at any time, including mid-combat and mid-cutscene. Resume, Restart from Checkpoint,
Settings, Accessibility, Return to Sanctuary, Quit. Every cutscene is skippable — the simulation
exposes `skipCutscene()` and the confirm inputs are wired to it.

## Layout review targets

Every screen should be reviewed at: small phone landscape, large phone landscape, tablet 4:3, tablet
widescreen, desktop 16:9, ultrawide, reduced resolution, large-text mode and high-contrast mode.

Screenshot capture is automated — `tools/capture-screenshots.mjs` drives the production build through
Playwright at desktop and phone sizes and writes to `docs/screenshots/`. Ultrawide, 4:3 and
reduced-resolution passes are not yet part of it.
