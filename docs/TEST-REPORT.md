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
- Deployed HTTPS application, public WSS connections, incognito browser play, or separate physical devices.
- Load testing, abandoned-room timers over real five-minute duration, and server restart recovery (recovery is intentionally not supported).

No supported browser-QA capability was exposed in the managed build environment. No preview server was started for browser QA. Local HTTP/WebSocket servers existed only inside the automated integration tests and were closed after them.

## Deployment status

Render is connected. The user approved the homelab workspace and Free plan. The source repository is now available; initial deployment is being prepared. Public verification remains pending.

## Human acceptance pass

1. Start locally or deploy the Node service. Create a campaign in a normal browser window; join using a private window.
2. Connect an Xbox controller, press a button with the page focused, and verify sticks, triggers, A/X/Y, D-pad and Menu.
3. Toggle viewpoints during movement and combat; confirm state and hit range remain unchanged.
4. Clear/capture the first castle; rescue survivors; recruit companions and guards; repair and barricade.
5. Lose and reclaim a castle while holding another. Observe fallen soldiers reanimate.
6. Complete a campaign in solo and online modes, then verify the results and restart.
7. Repeat on an actual phone and a second network through the eventual HTTPS URL.
