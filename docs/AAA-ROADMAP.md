# Swords & Shrouds — path to AAA (roadmap from cycle-14)

This roadmap is honest about where the game is and what is left before "AAA" is a fair label.
Update: cycle 14 (2026-10Q) in progress; cycle 13 live.

## Where we are now (after 13 shipped cycles)

**Shipped and verified:** browser-native Three.js/Cloudflare game, 9 castles across 3 regions,
co-op 2–4, companion soldiers, 11 weapons with distinct stats and server-authoritative combat,
4 undead appearances (variants/elites/bosses), siege escalation with a Shroud Warden boss,
difficulty modes (Squire/Knight/Warden), campaign journal/objectives/chronicle (16 lore entries),
run recap + epilogues, victory/defeat world mood, mobile touch HUD + device-aware quality, shield
bash, full audio soundscape (adaptive music, weather, landmarks, boss layer, stings), 80+ custom
assets (characters, weapons, landmarks, props), accessibility (captions, reduced motion, controller
settings, deadzone/sensitivity), QA harness with hash/freshness gates.

**Measured:** ~185 spawn draw calls / 1.64 M tris (from 88.5 k / 4.04 M at the start), ~17.6 MiB
payload (from 43.5 MB), 58/58 tests, tsc 0, deterministic builds, live deploy verified.

**Known visual debt:** character close-up look (pale, washed, helm/head band, cloak artifact — the
current hotfix), soft props at distance, limited animation variety, night scenes can read flat.

## What "AAA" would require, and the ladder

AAA is not a switch; it is the intersection of **content volume, craft consistency, and polish
budget**. Our equivalent target for a browser co-op action game:

1. **No visible defects in the first 10 minutes** on desktop, mobile and co-op.
2. **Art direction holds at close, mid and far range** (characters, props, landmarks, VFX).
3. **10–15 hours of authored progression** (vs ~2 h now), with reasons to replay.
4. **A performance floor** (60 fps on mid-range GPUs at medium; stable 30+ on phones).
5. **Verified on real hardware** (GPU/phone/controller), not just headless Chrome.

### Milestone A — Look & feel lockdown (cycles 15–18)
- **Character look v4** (in progress): remade/albedo-graded armour, deliberate face/helm design,
  no translucent cloak artifacts, faction colour read, new normal/ORM polish; per-body silhouette
  check at 2–12 m in both cameras; strict-mask palette stays 7/7.
- **Animation depth**: dedicated heavy-attack, shield bash, dodge/step-back, death variants, idle
  fidgets, siege-crowd reactions; blend-time polish; foot-slide fix (speed-matched run).
- **VFX pass**: hit sparks by material (already), blood decals/mud tracks, siege dust, banner cloth,
  torch smoke; verify at 20 m and 60 m.
- **Lighting pass**: key light/fill balance per region, interior/under-canopy contrast, moon shadows
  and torch pools that actually read (no more flat night).
- Acceptance: a 60-second close-up "hero shot" recording that a stranger would not call prototype;
  no washed-out characters; art gate checklist in QA.

### Milestone B — Content depth (cycles 18–26)
- **Enemies (from 1 kind + variants to 6+ families)**: hound/swarm, screamer (done), ranged
  corrupted, shield-bearer, elite champions with unique telegraphs, region-specific undead.
- **Bosses**: 3+ distinct bosses (Shroud Warden, a sieger, a nest-mother) with phases, arenas and
  mechanics; boss-intro cinematics (camera + text).
- **Progression**: per-run upgrades (weapon tiers, armour plates, camp tents, followers), rewards from
  castles/sieges, a meta-progression layer (keeps unlocks across runs) and a New Game+ modifier.
- **Campaign**: 3 acts with authored objectives per region (not just capture-X), 15–20 hand-placed
  encounters, rescue chains with dialogue, an endgame siege, 10–15 h playtime.
- **World variety**: 3–4 new landmark types per region, interiors for keeps/chapels, weather events
  with gameplay effects (snow slows, ash blinds).

### Milestone C — Systems & multiplayer depth (cycles 26–33)
- Loot/inventory UI, crafting/repair at camps, consumables with real decisions.
- Co-op roles: revive, shared resource, siege assignments; scaling by player count; anti-grief.
- Persistence/accounts: profiles, stats history, leaderboards (small), cross-session progression.
- Difficulty and accessibility: colour-blind palettes, UI scaling, full remap, one-hand mode.
- Balance: damage/HP curves, economy pacing, per-difficulty tuning validated with bot sims + human
  playtests.

### Milestone D — Technical polish & performance (continuous, hard gate each cycle)
- **Payload**: 17.6 MiB now; target ≤12 MiB with texture compression (KTX2 on capable GPUs), atlas
  merging, LODs for landmarks/props, streamed audio; keep quality.
- **Draw calls**: 185 spawn; target ≤140 at spawn, ≤250 in a full siege (merge materials/batches,
  instanced cutout groups, occlusion).
- **Stability**: memory ceiling on mobile, background-tab throttling, reconnect/resume robustness,
  network jitter handling; error telemetry in QA only.
- **Real-device matrix**: Windows/dGPU, Mac/M-series, Android mid-range phone, iPhone, Steam Deck;
  controller hardware (Xbox) rumble/input verified by a human.
- Acceptance: perf + memory budgets in CI-like harness; real-device checklist signed each milestone.

### Milestone E — Presentation & game feel (cycles 33–40)
- Title/menu as a scene (character on a ridge, camera move), character select with portraits and
  stats, loading screen art, death/victory cinematics, siege intro shots.
- Music: 3–4 region themes + boss/siege/ending cues at commercial quality (or licensed tracks);
  SFX pass (weapons by material, footsteps by surface — surface audio exists but needs an ear check).
- UI/UX: consistent iconography, combat log, minimap/compass depth, tooltips, tutorial island.
- Localisation-ready strings, subtitles for ambient barks (captions already exist).

### Milestone F — Release readiness (cycles 40–45)
- Real-stakes QA: multi-user live sessions, long-run soak (memory/leaks), cheat/exploit review,
  account abuse, rate limits.
- Store/live packaging: SEO/meta, OG images, changelog, privacy/terms, analytics consent.
- Marketing assets: trailer cut, screenshot set, press kit.
- Final acceptance: milestone-A checklist + 2 human playtest sessions with no P0/P1 defects.

## Near-term plan (next 5 cycles)

| Cycle | Goal |
| --- | --- |
| 14 (now) | Finish windmill/torches; **character look v4 hotfix** (materials, heads, cloak, markers) |
| 15 | Character atlas rebake v4: armour/leather/skin/cloth separation + palette gates; close-up shots |
| 16 | Animation depth: heavy attack, dodge/step, death variants, foot-slide fix; camera hit reactions |
| 17 | New enemy family #2 (ranged corrupted + hound analog) with distinct behaviours and telegraphs |
| 18 | New boss (siege behemoth) with phases + arena; boss intro camera; balance pass |

## Non-negotiables per cycle (unchanged)

`npm test` exactly 58/58 (extend in place), tsc clean, deterministic production build with
source/artifact freshness gate, `validate-assets` all pass, headless smoke + characters + mobile +
perf + co-op, QA screenshot review, deploy + live verification, docs/checkpoint updated.

## Debt register (honest)

- Character close-up look (hotfix in progress; atlas rebake planned cycle 15).
- Near-forge/chapel audio landmark **ear check** is human-only and still pending.
- Warden-mode forced-boss + forced Screamer **authoritative captures** deferred (owner sim evidence).
- Physical-device mobile, real-GPU and perceptual playtests not yet performed.
- Hardware controller rumble, mobile real-device layout, and long-session stability unverified.
- Enemy variety/progression/campaign length are the largest remaining content gaps.
