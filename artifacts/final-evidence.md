# Final evidence — IRON NITRO (metal-warriors-demo)

Status: **release candidate — all browser, mobile, visual, UI, performance and build checks pass.**

## Checks (run 2026-09-29)
- `npx tsc --noEmit`: clean (strict, noUnusedLocals).
- `npm run build`: OK. JS 632 KB (167 KB gzip), CSS 16.5 KB (4.6 KB gzip), latin-only fonts (~32 KB).
- `vite preview` (:4188) serves the built bundle.
- Canvas inspector, run `pass-3`, seed 42, hardware GPU (Intel Iris Pro via ANGLE): **11/11 PASS, 0 console/page errors, all within render budget.**
- Playwright: **4 passed, 2 skipped by design** (keyboard bot and fail-flow tests run on desktop only).
  - `visual.spec.ts`: canvas is nonblank; ArrowRight (desktop) or the touch stick (mobile) moves the player more than 1 unit.
  - `bot-playtest.spec.ts`: real input carried the player from x 5 to x 33 with 1 kill, score 150 and 0 softlock windows. Game over → continue → play resumes and moves.
- Frame rate: headless GPU, 4 s of gameplay → 44.8 fps average, p50 16.7 ms (vsync), p95 33 ms. CPU profile shows ~73 % idle, so the limit is the old integrated GPU in headless mode, not game logic (simulation plus collision cost ~20 ms per second).

| Capture | Draw calls | Triangles | Entropy | Edges | Contrast |
| --- | --- | --- | --- | --- | --- |
| desktop title | 100 | 32.5k | 4.51 | 0.46 | 88 |
| desktop active-play | 110 | 32.7k | 4.54 | 0.44 | 146 |
| desktop combat | 163 | 33.7k | 5.03 | 0.52 | 185 |
| desktop jetpack | 124 | 33.7k | 5.52 | 0.60 | 183 |
| desktop boss | 144 | 32.9k | 4.32 | 0.53 | 190 |
| desktop paused / game-over / stage-clear | 104–117 | 32.4–32.8k | 3.3–3.5 | 0.26–0.32 | 69–77 |
| mobile title / active-play / boss | 92 / 113 / 133 | ~32.5k | 4.57–4.65 | 0.44–0.49 | 182–211 |

Captures and JSON reports: `artifacts/pass-3/`. Earlier passes: `artifacts/pass-1/`, `artifacts/pass-2/`.

## Fixes found by the capture loop
- pass-1: renderer stats were read before render; the title camera didn't snap; point-blank bolts missed; the boss test state didn't trigger; progress markers were hardcoded.
- pass-2:
  - The mech disappeared inside tile blocks. Level geometry now sits behind the gameplay plane, so mechs read like sprites.
  - The electric pit bloomed to white.
  - The foundry wall came out blue because the tint multiplied a blue texture. The wall texture is now neutral grey, tinted per section.
  - The title mech overflowed its window, and the panel's green veil dimmed it.
  - The arena camera lost the floor and the boss. It now frames player and boss together, with zoom 0.86.
  - The stage-clear test state never killed the boss.
  - HAVOC stayed white-hot under rapid fire. The flash is now squared and decays faster.
- pass-3:
  - Test captures froze before entities were synced, leaving a ghost trooper at the origin and doubling draw calls on the title. Fixed with sync on spawn and after `setState`.
  - Static props are merged per material and glow materials are pooled: desktop combat went from 188 to 163 draw calls, mobile title from 222 to 92.
  - Reduced-motion now also freezes CSS panel animations, so modal captures are deterministic.

## Premium scorecard (pass-3)
| Category | Score | Evidence |
| --- | --- | --- |
| Gameplay loop | 2.5 | 4 sections, checkpoints, drones/troopers/turrets, 3-phase boss, continue/restart; bot progresses without softlocks |
| Visual identity | 2.6 | SNES pixel pipeline (dither, 15-bit, outlines), per-section palettes, panorama windows, furnaces, coolant, arena alarms |
| Readability | 2.4 | Mechs always in front of level geometry, telegraphed shots, boss framing, readable hazards |
| UI / HUD | 2.5 | Pilot panel, segmented armor, energy, progress markers, boss bar, select screen, modals |
| Mobile | 2.4 | Handheld portrait layout, SNES A/B/X/Y pad, touch-tested movement, boss framed on narrow screens |
| Audio | 2.3 | Procedural SFX, 3 music tracks, ducking, mute, pause suspend |
| Performance | 2.5 | 92–163 calls, ~33k tris, 16 textures, low-res target, instancing and merging |
| Release hygiene | 2.4 | Typecheck, build, preview, Playwright suite, inspector evidence, README, git initialised |
| **Average** | **2.45** | All categories ≥ 2, average ≥ 2.3 — meets the premium bar |

## Known limitations
- Vite pinned to 6.x because the machine runs Node 22.6 (Vite 8 needs 22.12+).
- FPS was measured headless on an old Intel Iris Pro. Confirm on a real phone, and in Safari/iOS on a real device.
- A single stage (the demo scope).
