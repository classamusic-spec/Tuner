# Player controller

The controller is the game. Everything else — combat, bosses, secrets — is built on top of how
it feels to move, so it was built and tuned before content existed.

## Principles

1. **Input is never gated by animation.** The movement state machine drives the animation, never
   the reverse. A state change is reflected in the target pose on the same call. There is no
   wind-up, no lock-out, no "wait for the animation to finish".
2. **Everything scales by `dt`.** No behaviour may differ at 30, 60 or 144 fps. This is asserted:
   one second simulated at `dt = 1/60` and `dt = 1/120` must land the player within 0.05 m of
   the same position.
3. **Forgiving inputs, honest physics.** Coyote time and jump buffering make the controls
   generous without making the world lie about where the ground is.
4. **Every number is tunable in one place.** `MovementConfig` holds them all, so the debug
   overlay can expose live sliders without touching gameplay code.

## Defaults

| | Value | |
| --- | --- | --- |
| Walk / run / sprint | 4.2 / 8.6 / 12.4 m/s | analogue magnitude picks the tier |
| Ground accel / decel | 74 / 62 m/s² | |
| Air control | 0.62 | fraction of ground acceleration |
| Jump height | 3.05 m | velocity derived as √(2gh), not hard-coded |
| Double jump | 2.5 m | |
| Jump-cut gravity | ×2.6 | applied on button release — one button, variable height |
| Fall gravity | ×1.45 | snappy arc rather than floaty |
| Max fall speed | 38 m/s | |
| Coyote time | 0.11 s | plus accessibility and difficulty bonuses |
| Jump buffer | 0.13 s | |
| Dash | 24 m/s for 0.17 s | ≈ 4 m of travel, 0.32 s cooldown |
| Air dashes | 1 | refreshed on landing and on wall contact |
| Slide | 13.5 m/s for 0.55 s | |
| Wall slide | 3.4 m/s | cling times out after 1.6 s |
| Wall jump | 10.5 m/s out, 12.2 m/s up | input locked for 0.12 s |
| Grind | 17 m/s | |
| Bounce | 17 m/s | |
| Capsule | r 0.36 m, h 1.6 m | step height 0.42 m, max slope 52° |
| Flow threshold | 9 m/s | drives camera FOV and the flow rank bonus |

Practical consequences worth knowing when authoring a stage: a running jump clears roughly
6–7 m of horizontal gap; a jump plus air dash clears roughly 10–11 m. Stage tests assert
declared traversal pairs against these numbers, so an unreachable gap fails a test rather than
a play-through.

## The move set

Walk, run, sprint, jump, variable jump height, double jump, air dash, ground dash, slide, wall
jump, wall cling, ledge grab, contextual mantle, rail grinding, harmonic bounce, fall recovery,
moving platform riding, slope handling, swimming, and low-gravity movement in celestial regions.

A few that carry more weight than their line in the list suggests:

**Variable jump height.** One button. Initial velocity comes from `jumpHeight`; releasing early
multiplies gravity by `jumpCutGravityScale`. This is what makes both a tap-hop and a full leap
available without a second input.

**Coyote time and jump buffering.** The two mercies that make a platformer feel fair rather than
twitchy. A jump pressed within 0.11 s of leaving a ledge still fires; a jump pressed up to
0.13 s before landing fires on touchdown. Both are asserted at their boundaries — inside the
window it fires, outside it does not.

**Wall jump with input lock.** For 0.12 s after a wall jump, horizontal input cannot cancel the
push-off. Without this, holding toward the wall immediately re-sticks and the jump reads as
broken.

**Moving platform inheritance.** The stage system runs before movement so platforms have already
advanced and written `player.platformVelocity`. Reverse that order and the player drifts off a
3 m/s platform by 5 cm every frame — visible, and infuriating.

**Landing assist.** An optional gentle horizontal correction toward the ground ahead while
airborne and descending, scaled by the accessibility setting and difficulty. At zero it is
exactly a no-op, which is asserted rather than assumed.

## State machine

`idle → walk → run → sprint`, plus `jump`, `doubleJump`, `fall`, `dash`, `airDash`, `slide`,
`wallCling`, `wallJump`, `ledgeGrab`, `mantle`, `grind`, `bounce`, `swim`, `hurt`, `downed`,
`cutscene`.

Every transition emits `player:stateChanged`, and the notable ones emit their own events
(`player:jumped`, `player:dashed`, `player:landed` with impact speed, `player:wallCling`,
`player:ledgeGrabbed`, `player:bounced`, `player:railAttached`). Rendering, audio and haptics all
subscribe; none of them can affect the movement.

## Collision

Movement resolves through `PhysicsWorld.moveCharacter` — a capsule collide-and-slide against
authored geometry, with:

- Contacts classified as floor, wall or ceiling by their normal against `maxSlopeDegrees`.
- Blocked velocity components removed while tangential speed is preserved, so running along a
  wall stays smooth.
- Step-up over lips to `stepHeight` without a jump.
- Ground snapping while descending slopes, so the player does not launch off every ramp.
- Triggers reported without blocking.

The solver is deterministic and kinematic, not a rigid-body engine. Precise platforming wants
reproducible, authored-feeling motion, and an impulse solver's emergent behaviour is the enemy
of that.

## Verification

51 movement tests currently pass, covering jump apex against the configured height, jump-cut
producing a measurably lower apex, coyote and buffer windows at their boundaries, double-jump
consumption and refresh, dash speed/duration/cooldown, air-dash refresh, wall-jump velocity and
input lock, framerate independence, determinism, and landing assist being a true no-op at zero.

What tests cannot tell us is whether it *feels* good. That is judged by playing it.
