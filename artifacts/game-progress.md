# IRON NITRO — Metal Warriors-style web demo

## Intent and constraints
- Web demo inspired by *Metal Warriors* (SNES, 1995), based on the user's reference collage: side-scrolling mech action inside an orbital station, red/orange hero mech "Nitro", purple enemy mechs and drones, hazard-striped industrial tiles, space backdrop with planet and capital ship, green "PLAYER ONE SELECT" panel.
- Visual style chosen by the user: **2.5D pixelated** — low-poly 3D mechs and world rendered at SNES resolution (~224 lines), integer upscaled, 15-bit colour quantisation + ordered dither, depth outlines.
- Assets: **procedural only** (no external generation services). Audio: procedural Web Audio synth (SFX + chiptune music).
- Bar: premium ("premium futuristic" request carried over). Targets: desktop + mobile.

## Design brief
- Player promise: pilot a heavy assault mech through an enemy-held orbital foundry and destroy its guardian.
- Target feeling: weighty, loud, arcade-precise 16-bit mech combat.
- Primary verb: shoot (fusion rifle, 3 aim angles). Secondary: jump + jetpack hover, beam-saber slash (also deflects shots), energy shield (blocks frontal shots).
- Every 5–30 s: dodge/block a telegraphed shot, close distance or kite, kill, grab energy.
- Across 1–5 min: sections escalate hangar -> foundry pits -> reactor shaft -> boss.
- Lose / learn / restart: armour bar hits 0 -> explode -> respawn at last checkpoint (3 lives), game over -> instant restart.
- Reward: score, armour repair cells, spread-shot upgrade (lost on death).
- Risk: jetpack and shield share one energy bar — flying high or turtling costs the other.
- Better player: saber-deflects instead of shielding, keeps energy for jet routes, prioritises turrets.
- Next decision communicated by: telegraph glows (drone eye, trooper laser sight, turret charge, boss crouch), HUD energy bar, arrow "GO" prompt.
- Non-goals: ejecting from the mech on foot, multiplayer, multiple stages, mech selection.

## Core loop contract
Player **shoots/slashes** to **clear the station and reach the guardian** while **telegraphed enemy fire and hazards** create risk; success gives **score, repair cells and weapon upgrades**; failure costs **a life and returns to the last checkpoint**.

## Level plan — "Orbital Foundry" (single stage, ~165 tiles wide, 18 tall)
- Camera: side view, 14 tiles tall, looks ahead in facing direction, clamped vertically.
- A Hangar (x 0–42): start, first decision = first drone at x≈22 (shoot or dodge), crates teach jump, catwalk + repair cell teach jet.
- B Foundry (x 42–88): electrified pit with floating catwalks, two troopers (burst fire + shield when pressured -> saber), checkpoint, high spread-shot pickup requires jetpack energy.
- C Reactor shaft (x 88–132): stepped climb requiring jet, wall/ceiling turrets, drone pair, checkpoint before boss.
- D Guardian arena (x 132–165): gate seals, boss HAVOC: phase 1 volley + stomp shockwave; phase 2 (<60%) adds telegraphed dash charge; <30% summons drones.
- Recovery beats after every fight (repair cells, empty corridor).

## Decisions
- Custom AABB tile physics (fixed 120 Hz step) — platformer needs no rigid-body engine.
- Pixel pipeline: HalfFloat low-res target -> composite shader (ACES tone map, sRGB, Bayer dither, 5-bit quantise, depth outline) -> nearest upscale.
- Mirror flip via scale.x = -1 so the rifle arm always faces the camera like a sprite.

- View height 12 units, mechs scaled up (NITRO 1.12, HAVOC 1.9) so silhouettes read at 232 lines.
- Per-section wall palettes (hangar blue, foundry rust, reactor teal, arena magenta) + section set dressing; visual-only hull fill outside the grid.
- Vite pinned to 6.x because the machine runs Node 22.6 (Vite 8 needs 22.12+).

## Status
- [x] Project + scaffold + deps
- [x] Playable loop (4 sections, checkpoints, boss HAVOC, lives/continue, stage clear)
- [x] Premium graphics pass 1 (pixel pipeline, toon mechs, VFX) — pass-1 inspector PASS
- [x] Graphics pass 2 (section palettes, panorama window, furnaces, coolant, columns, dado, electric glow, hull fill; black foreground pillars removed) — typecheck + build OK
- [x] UI states + touch (title select, HUD, pause, game over, clear, SNES pad)
- [x] Audio (procedural SFX + 3 music tracks)
- [x] Production build (165 KB gzip JS, latin-only fonts) + preview smoke test
- [x] Pass-2 captures: found mech hidden by tiles, electric bloom, blue foundry, title overflow, arena framing, stage-clear state, boss white-out
- [x] Pass-3 captures: 11/11 PASS within budget (desktop + mobile, all 8 states); Playwright 4 passed / 2 skipped by design
- [x] Draw-call pass: static merge by material, pooled glow materials, entity sync on spawn
- [x] git init (no commits yet)
- Final evidence and scorecard (avg 2.45): `artifacts/final-evidence.md`
