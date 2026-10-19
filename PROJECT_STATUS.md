# Swords & Shrouds — project checkpoint

Updated: 2026-10-19. Read this file first when continuing in a new chat.
Do not require the previous conversation or import its full transcript.
Inspect current code and git history before assuming this checkpoint is still current.

## Latest completed batch — companion AI

- Gameplay commit: e1a9345c563bfba0acdeed3e567501b04025d69e on main.
- Hosting pin updated in neilandrew.dev commit 6169bb3de68618adf49e5bf41aeb53fe2423e9e1 to that gameplay commit.
- Defender: close protection and frontal blocking between swings.
- Flanker: wider threat response, less crowded targets and side approaches.
- Heavy: prioritizes corrupted knights with slower, stronger attacks.
- Separate follow/hold/guard formation slots; wall-aware soldier separation.
- Recruitment and travel seek unoccupied positions; travel leaves hold/guard units behind.
- Explicit Attack orders retain longer pursuit; old saved soldiers receive roles.
- Validation: 54 tests passed (six new companion regressions), TypeScript and Vite build passed, git diff --check passed.
- Existing solo rescue and independent WebSocket tests still pass.
- Visual gameplay and live Cloudflare deployment have NOT been verified. Hosting integration tests were not rerun.
- worker.js imports .game-build/src/simulation/game.ts, so the hosting source pin controls server simulation as well as client build.
- Next task: inspect supplied character variants and survivor/cauldron assets, integrate them, then correct per-weapon grips and animated grounding. Visually check formations and combat balance.

## Recovery baseline (historical)

- Game repository: https://github.com/neil-andrew-olson/swords-and-shrouds
- Inspected main gameplay commit: 5f7dfa2baa4c14f2cdb886fabf80c6dc0d0eed50.
- Hosting repository: https://github.com/neil-andrew-olson/neilandrew.dev
- Hosting main inspected at 09086cf98c647d8edd8b5087f46cb3b69cda0b5c.
- Hosting game-source.json pins the game to 5f7dfa2baa4c14f2cdb886fabf80c6dc0d0eed50.
- Hosting scripts/build-game.mjs fetches that revision and builds the client under /games/swords-and-shrouds/.
- Hosting wrangler.jsonc configures worker.js, GAME_ROOMS / GameRoom Durable Objects, and game WebSocket/health routes.
- Live deployment state was NOT verified during this recovery session.
- There were no AGENTS.md or PROJECT_STATUS.md files in the inspected game tree.

## Current implementation

TypeScript / Three.js / Vite client, authoritative simulation, Node Express/ws server.
The current campaign has three regions with nine castles and nine survivor groups (expanded beyond the original three-castle design).
Solo companions, up to four online players, castle capture/loss/reclamation, sieges, rescue, resources, upgrades, artillery, downed-player revival/corruption, and first/third-person cameras exist.
Five-weapon shared discovery and individual equipment, weapon stats, Xbox mappings, and combat feedback exist.
See src/shared/weapons.ts, src/simulation/game.ts, src/client/main.ts and README.md.

## Unfinished user priorities — verified against source

1. Ally spacing and distinct behavior: implemented in the latest batch above; browser playtesting and balancing remain.
2. Character/enemy variety:
   - src/client/assets.ts selects hero for players, ally for soldiers, fallen for corrupted knights and the existing skeleton for zombies.
   - The requested additional berserker/ranger/templar/survivor/skeleton/zombie variants are not present under those names in this tree.
3. Weapon grips, blade direction and swings:
   - src/client/equipment.ts still guesses the longest axis and offsets the model by length * .34.
   - Replace guesses with measured per-asset grip/orientation data and inspect hand attachment through animations.
   - Existing size tests do not establish that handles sit correctly in hands or blades face correctly.
4. Ground contact:
   - Inspect bind pose and animated foot heights in src/client/custom-character.ts and assets.ts; visually verify across clips.
5. Survivor outposts:
   - src/client/scene.ts still builds box-shaped survivor placeholders.
   - Replace with supplied survivor and cauldron models after inspecting source assets.

At the recovery baseline, earlier chat statements that all visual polish changes were integrated were NOT confirmed by the saved main branch. Recover any newer saved artifact before duplicating work, but do not treat chat statements as commits.

## Asset recovery leads

User supplied these Library archives; these are leads, not inspected contents:
- characters(1).zip — libfile_0afeb12816648191bf3f6e3f427aad4d
- characters_static(1).zip — libfile_86850408a59c8191bc10fd97cf3f998b
- weapons(1).zip — libfile_d4ef8653a25c819184effe72fb8d1372
- structures(1).zip — libfile_df202a09341c8191bf0131e234e699d2
- resources(1).zip — libfile_e97b867a9e048191935f1d21ea8a70fe
- defense(1).zip — libfile_f60c4ed0a0e08191babf7655a9b09dd8

## Verification performed 2026-10-19

At gameplay commit 5f7dfa2:
- npm ci --include=dev completed.
- npm test: 48 passed, 0 failed, including local independent WebSocket clients.
- npm run build: TypeScript check and Vite production build passed.
- No browser visual validation, physical controller test, full campaign playthrough, or live deployment verification was performed.
Passing automated tests does not resolve the reported visual/AI polish defects.

## Next work session

Ally roles and spacing are implemented. Inspect supplied character/prop assets next and implement visual fixes with browser verification.
Before publishing game changes through neilandrew.dev, inspect its worker and simulation integration as well as its client build: updating the game-source pin alone must not be assumed to update authoritative server gameplay.
Run both repositories' relevant tests and build checks, and verify deployed client/server behavior.

## Continuity procedure

After each completed batch, commit the changes and update this file with:
- exact implementation commit, branch, changed behavior;
- checks actually run and their results;
- remaining defects and next concrete task;
- hosting pin / deployment status, keeping source and live verification separate.

Future prompt: "Continue Swords & Shrouds from PROJECT_STATUS.md in neil-andrew-olson/swords-and-shrouds. Inspect current commits and complete the next unfinished task. Update the checkpoint."
