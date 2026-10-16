# Verification report

## Automated checks completed

- TypeScript strict checking: passed.
- Vite production build: passed.
- Production dependency security audit: zero reported vulnerabilities at build time.
- 16 automated tests: passed with no skips.

Tests cover initial campaign structure, input schema validation and normalization, stale-input timeout, wall collision, melee direction/range/cooldowns, five-second capture and cancellation, single capture rewards, rescue gating and recruitment costs, companion commands, delayed corruption, siege warning/spawn/loss/reclamation, victory prerequisites, respawn and defeat, snapshot privacy, Xbox standard mapping/deadzone/button edge handling, melee obstruction by stone walls, frontal blocking damage reduction, and AI routing from behind a castle through its entrance.

The network integration test starts a real HTTP/WebSocket server and connects independent clients. It verifies room creation, joining, consistent world structure, replicated movement, invalid room codes, four-player capacity, a second isolated room, reconnect token restoration, room leadership transfer, restart permission, restart state, and snapshot delivery to multiple rooms. HTTP health responds successfully.

Controlled simulation fixtures accelerate tests by setting selected positions, castle state, or elapsed time. These tests validate rules; they are not a claim of human campaign completion.

## Not yet verified

- Full uninterrupted solo or co-op campaign completed through player controls.
- Visual browser render, mobile layout, camera feel or clipping.
- Physical Xbox controller over USB/Bluetooth.
- Controller-only navigation usability and touch responsiveness.
- Gameplay balance and remote latency under realistic conditions.
- Incognito browser gameplay or separate physical devices. Public HTTPS and WSS were verified as described below.
- Load testing, abandoned-room timers over real five-minute duration, and server restart recovery (recovery is intentionally not supported).

The deployed page was opened in the cloud browser. Its WebGL renderer is disabled by the browser environment, so it displayed the application’s WebGL-unavailable message. This prevented visual 3D and browser-control testing. No browser security settings were changed. Local HTTP/WebSocket servers existed only inside the automated integration tests and were closed after them.

## Deployment status

Initial deployment verified live on 2026-10-16 UTC (2026-10-15 America/Chicago).

- Public URL: https://swords-and-shrouds.onrender.com/
- Repository: https://github.com/neil-andrew-olson/swords-and-shrouds
- Deployed game commit: 9848f482d1c29e5f458d38d0228cd41abde2cfcf
- Render service: srv-db8p5sbbc2fs73bmlbo0
- Initial deployment: dep-db8p5t3bc2fs73bmldh0
- Workspace: homelab; plan: Free; region: Ohio.
- HTTPS /health returned 200 and {"ok":true,"rooms":0}.
- The live root page loaded with the correct game title and controls.
- Two independent WSS clients joined the same public room with distinct player identities, received three castles, and observed authoritative movement replicated from one client to the other.
- Disconnect and resume restored the original public-session player identity.
- Recent Render error-log query returned no errors.

The command-line WSS client required the environment’s configured outbound proxy; after using that normal network path, both public tests passed. This validates the service protocol, not physical-device gameplay.

## Human acceptance pass

1. Start locally or deploy the Node service. Create a campaign in a normal browser window; join using a private window.
2. Connect an Xbox controller, press a button with the page focused, and verify sticks, triggers, A/X/Y, D-pad and Menu.
3. Toggle viewpoints during movement and combat; confirm state and hit range remain unchanged.
4. Clear/capture the first castle; rescue survivors; recruit companions and guards; repair and barricade.
5. Lose and reclaim a castle while holding another. Observe fallen soldiers reanimate.
6. Complete a campaign in solo and online modes, then verify the results and restart.
7. Repeat on an actual phone and a second network through the eventual HTTPS URL.

## Fortress update

Added two authoritative castle tiers (24W/10I, then 40W/18I), tier-aware repairs, restorative castle aura, construction access from the entrance, survivor beacons and directional objective guidance. Added soft shadows, antialiasing, tone mapping, armor detail, animated capes and sword arcs, enemy windup rings, and floating damage numbers. Xbox camera toggle and existing controls remain supported.

18 tests pass, including shared upgrade resource accounting, tier caps, proximity/ownership checks, tier-aware repairs and healing. TypeScript and production build pass. Cloud browser WebGL remains unavailable; visual appearance, physical controllers and mobile performance require human playtesting. This update improves the playable build; it is not a claim of finished production quality.

## Free animated asset integration

Replaced visible player, companion and corrupted knight placeholders with Quaternius's animated knight; Shrouded enemies now use KayKit skeleton warriors. Idle, movement, attack and death animations use separate per-character mixers and skeleton clones. Imported Kenney roof, stone pillar, rock and decorative ballista models. All downloaded art is CC0; credits and original included licenses are served under /assets/.

21 tests pass: previous gameplay/network tests plus GLB container integrity, self-contained textures/buffers, sanitized bone-name compatibility and required animation clips. Production build passes. This does not certify visual alignment, camera appearance, controller hardware, or mobile frame rate; those need a WebGL-capable human playthrough. Models remain stylized, not equivalent to the detailed reference render. Procedural fallback models remain if asset loading fails.
