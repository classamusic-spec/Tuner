# Build and release

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 22.22.2 | `>=20.11` required |
| pnpm | 10.33.0 | the workspace uses pnpm workspaces; npm and yarn will not resolve `workspace:*` |
| TypeScript | 5.9.3 | pinned; the workspace builds with project references |
| Rust / Cargo | 1.94.1 | desktop only |

Additional toolchains, needed only for the target in question:

- **Desktop (Tauri 2):** on Linux, `webkit2gtk-4.1`, `gtk+-3.0`, `libayatana-appindicator3`,
  `librsvg2`; on Windows, the MSVC build tools and WebView2; on macOS, Xcode command line tools.
  A Tauri bundle can only be produced on the OS it targets — there is no supported cross-compile
  from Linux to Windows or macOS.
- **Android:** Android SDK (platform 34+), build tools, NDK, and a JDK 17. `ANDROID_HOME` set.
- **iOS:** macOS with Xcode and CocoaPods. Cannot be built on any other OS.

## Install

```bash
pnpm install
```

## Everyday commands

```bash
pnpm dev              # web dev server on http://localhost:5173
pnpm typecheck        # tsc -b across every package
pnpm lint
pnpm test
pnpm verify           # typecheck + lint + test
pnpm build            # typecheck, then production web build
pnpm preview          # serve the production build on :4173
```

## Web

```bash
pnpm build:web
```

Output lands in `apps/web/dist`. The build targets ES2022, emits source maps, and splits
Three.js and React into separate chunks so the menu shell can paint before the renderer
finishes downloading.

The PWA manifest and service worker come from `vite-plugin-pwa` with `registerType:
'autoUpdate'`. The precache ceiling is raised to 8 MiB because Three.js alone exceeds the 2 MiB
default. Installing the PWA gives an offline-capable, fullscreen, landscape-locked client.

Serve `dist/` from any static host. No server-side component is required; Supabase is optional
and only used for cloud features, which are not on the critical path.

## Desktop (Tauri 2)

```bash
pnpm --filter @tuner/desktop tauri build
```

`tauri.conf.json` runs the web build first and bundles `apps/web/dist`. Bundle targets are
configured for deb, AppImage, MSI, NSIS, dmg and app — each produced only on its own OS.

The webview CSP is locked down: `default-src 'self'`, scripts limited to self plus
`wasm-unsafe-eval`, no remote connections. If a future feature needs the network, widen it
deliberately rather than removing it.

## Mobile (Expo)

```bash
pnpm --filter @tuner/mobile start        # Metro dev server
pnpm --filter @tuner/mobile prebuild     # generate native projects
pnpm --filter @tuner/mobile android      # requires the Android SDK
pnpm --filter @tuner/mobile ios          # requires macOS + Xcode
```

`metro.config.js` is configured for the monorepo: the workspace root is watched, both
`node_modules` directories are searched, hierarchical lookup is disabled and symlinks are
enabled — all four are required for pnpm's store layout.

The mobile host shares `game-core`, `physics`, `input`, `audio`, `platform`, `persistence` and
`game-content` with the web build. It does not share `@tuner/rendering`, which is
React-Three-Fiber-for-web; the native host renders through `expo-gl` with Three.js directly
against the same simulation state.

## Release checklist

1. `pnpm verify` passes with zero failures.
2. `pnpm build:web` succeeds; check the bundle size report.
3. `pnpm test:e2e` passes against the production build.
4. Play the critical path start to finish on the target platform. Automated tests do not
   establish that a game is playable.
5. Confirm save/load round-trips and that an older save still migrates.
6. Confirm keyboard, gamepad and touch all reach gameplay from the title screen.
7. Confirm each graphics tier renders and the adaptive controller settles.
8. Profile on a real device per tier and record the numbers in `docs/EVIDENCE.md`. Do not
   record a target as if it were a measurement.
9. Update `CHANGELOG.md`.
10. Tag the release.

## What was actually built in this environment

Recorded honestly, because the difference matters:

- **Web:** built and verifiable here.
- **Desktop:** configuration written and reviewed; **no binary produced** — this container has
  neither `webkit2gtk-4.1` nor `gtk+-3.0`, and Windows/macOS bundles cannot be cross-compiled
  from Linux regardless.
- **Android:** configuration written; **no APK produced** — no Android SDK, no `ANDROID_HOME`.
- **iOS:** configuration written; **not buildable** — requires macOS.

See `docs/EVIDENCE.md` for the exact commands run and their output.
