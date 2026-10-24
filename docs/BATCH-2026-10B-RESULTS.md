# Batch 2026-10B — Results (readability, combat feel, arsenal depth, live/co-op QA)

Second autonomous batch after [`BATCH-2026-10-RESULTS.md`](./BATCH-2026-10-RESULTS.md). Contract:
[`docs/BATCH-2026-10B-SPEC.md`](./BATCH-2026-10B-SPEC.md). Browser evidence:
[`docs/QA-REPORT.md`](./QA-REPORT.md) and the gitignored `qa/` folders.

## Shipped

**Readability / atmosphere** (`scene.ts`, `postfx.ts`, `terrain-surfaces.ts`)
- Removed the white ground fill pool: the player-following PointLight became a shadowless
  camera-following DirectionalLight; the constant 13-torch + fill light budget stays shader-stable.
- Rebalanced exposure/moon/hemisphere and added a dusk-blue ambient floor; night-sky IBL raised to
  1.0 with actor `envMapIntensity` 1.7, so characters read at distance instead of silhouettes.
- The moon was lowered into the default frame (plus 340 low stars): moon disc, halo and star field
  are visible in both third- and first-person; the dark night sky gradient (batch-1 fix) stays.
- Road/cobble tinted to grey stone (0.42/0.48); the ground detail albedo is remapped cooler,
  lower-contrast and darker so moonlit grass no longer reads as day-green polygons.
- Adaptive quality in the composer: sustained frame time > ~28 ms steps the pixel ratio toward 1.0
  and recovers when healthy.

**Combat feel** (`scene.ts`, `effects.ts`)
- Weapon-class first-person motion: thrust / cleave / crush / sweep, mapped by weapon id.
- Pooled world-space swing-trail arcs (14-instance additive ribbon, per-class colour).
- Brief hit-stagger lean, brighter HDR impact sparks, and long-lived pooled ground blood/corruption
  splatter decals (32 cap, procedural mask, one draw call).
- Two-handed support-hand pose rewritten (`custom-character.ts`): analytic two-bone reach + finger
  aim + clavicle assist; wrist→shaft distance 0.64 m → 0.11–0.13 m with no allocation and no
  grounding regressions.

**Arsenal + environment**
- Two new weapons: `flamberge` (2H wavy greatsword, 60 dmg / 4.2 reach / 1.1 s) and `mace`
  (1H flanged mace, 44 dmg / .95 s, shield). Canonical measured grips, attached diagonals 1.75 / 0.88
  vs the 2.2 gate; 10 weapons total; nine castle racks cover every non-sword weapon exactly once.
- Survivor camps get 27 baked tents (3 per camp, varied yaw/scale, culled with the camp) and the
  Castle 1 → 2 road plus the other regions get 10 low ruined stone-wall segments (5.2–6.6 m,
  ≥10.6 m road clearance, no gate-corridor conflicts).

**Audio**
- Synthesised event stingers for castle capture, survivor rescue, siege warning, victory and defeat,
  driven from authoritative state transitions with replay/gap guards.
- Weapon-specific swing synthesis profiles (thrust/cleave/crush/sweep) layered over the existing
  whoosh/impact/block/parry audio, plus a very quiet plague-nest pad.

**Assets** (asset-forge, see `docs/ASSET-PIPELINE.md` for sources/licences/changes)
- `flamberge.glb.gz` 3,366 tris / 1,190 KB, `mace.glb.gz` 3,366 / 241 KB, `camp_tent.glb.gz`
  5,940 / 1,369 KB, `stone_wall.glb.gz` 7,907 / 770 KB — plain glTF 2.0, gzip-9, embedded images,
  indexed + TEXCOORD_0, no compression extensions; total 3.57 MB.

## Verification

| Gate | Result |
| --- | --- |
| `npm test` | **58 / 58 passing**, exactly 58 `test(...)` blocks |
| `npx tsc --noEmit` | 0 errors |
| `vite build` (bundled Node 24; system Node 22.11 < Vite 7 floor) | success — `index-KD7Bp8Pr.js` 774.05 kB / 206.88 kB gzip |
| `scripts/validate-assets.mjs` | 62/62 checks (4 new assets enforce 3,400/3,400/6,000/8,000 tri budgets) |
| Headless local smoke (Lead, `qa/final-batch2`) | **16/16 gates**, 10 weapon cards, 0 page/console/log errors, 0 bad responses, 0 asset 404s |
| Live URL baseline, deployed batch-1 (QA) | **17/17**, 8 cards (old bundle), 0 page errors, wss connected |
| 2-player co-op (QA, `qa/coop`) | **18/18** — same room, both snapshots list both players, movement propagates, shared weapon unlock syncs (`["sword","hammer"]`), both HUDs live, 0 errors |

QA's visual checklist confirmed: tents grounded beside camp furniture; low ruined walls flank the
road with flush ends; 10 weapon cards; flamberge + mace in the authoritative rack drops; moon/halo/
stars visible; dark night restored; cooler ground and grey stone road; actors readable near.
Swing trail/stagger/decals are implemented and runtime-clean but could not be captured in a
screenshot at the software renderer's 0.6–0.8 fps.

### WebSocket reconnect root cause (fixed)

QA proved the spurious `1006` closes were renderer main-thread stalls (SwiftShader 0.6–0.8 fps)
delaying WebSocket pongs past the local server's single-miss 15 s heartbeat → `ws.terminate()`;
the client auto-resumed correctly (no navigation, no server load). The local authoritative server now
tolerates two consecutive missed pongs (~30 s) before terminating, so slow devices keep their
session. The client reconnect path itself was correct and unchanged.

## Remaining known defects / next tasks

1. Swing trail, hit stagger and splatter decals still need a real-GPU visual pass (QA hardware runs
   at 0.6–0.8 fps under SwiftShader and can't catch the 0.22 s windows).
2. Distant NPCs are readable but still dark; the tent reads as a flat canopy rather than a pitched
   tent; first-person road is still fairly light grey.
3. Real-GPU performance/playtest, perceptual audio, physical controller, mobile HUD and a full
   campaign run remain unverified; the Cloudflare-Insights beacon request fails cosmetically in
   headless Chrome.
4. Pre-existing `gatehouse.glb.gz` still uses `KHR_materials_pbrSpecularGlossiness` (loader warning).

## Commits

- Game repo: this batch's squashed commit on `main` (see `PROJECT_STATUS.md` for the exact SHA).
- Hosting repo: pin updated to that commit and rebuilt; live verification recorded in
  `PROJECT_STATUS.md`.
