# Swords & Shrouds

An early playable cooperative medieval survival campaign for 1–4 players, with Xbox controller support and freely switchable first-person / third-person cameras.

## Run on Windows

Install Node.js 22 or newer. Extract this entire ZIP into a folder, then double-click `START-WINDOWS.cmd`. It installs the locked dependencies, builds the client, and starts the game server. Keep that window open and visit http://localhost:3000 in your browser. This address works only after you start the server on your own computer.

Alternatively, from the project folder:

```sh
npm ci
npm run build
npm start
```

Run tests with `npm test`. No credentials or database are required for local play. A local server is not a public deployment. Do not open index.html directly; it needs the server.

## Play

Choose a knight name and Begin a campaign. Solo begins immediately with two Oathsworn companions. For multiplayer, share the room code or invitation link. Up to four people join from their own browsers; everyone uses the same server.

Clear the Fallen Keep, then hold Interact at its banner for five seconds. Rescue nine marked survivor groups across Green March, Ashen Moor and Frozen Crown after defeating nearby undead. Reclaim all nine castles. Hold all nine castles and rescue every group to expose the plague nest in the far north. Destroy it to win.

Keep captured castles defended. Sieges have a 30-second warning. Enemies damage barricades and gates, then capture an unguarded banner in eight seconds. Fallen castles can be reclaimed. Losing every friendly castle after the first capture loses the campaign.

Wood and iron are shared. Pick up supply crates with Interact; defeated enemies also yield materials. At a friendly banner: repair (8 wood, 2 iron), barricade (12 wood, 4 iron), companion or guard (3 iron, 1 recruit). Rescues provide four recruits. Guards defend their assigned castle. Soldiers reanimate seven seconds after death as corrupted knights. Humans respawn after eight seconds.

## Controls

| Action | Keyboard / mouse | Xbox standard mapping | Touch |
|---|---|---|---|
| Move | WASD | Left stick | Left stick |
| Look | Mouse after clicking world | Right stick | Drag right area |
| Sword | Left mouse | RT or RB | Hold Attack |
| Block | Right mouse | LT | Hold Block |
| Interact / capture | Hold E | Hold A | Hold Interact |
| First / third person | V | Y | View button |
| Heal | H | X | Heal button |
| Follow / Hold / Attack | 1 / 2 / 3 | D-pad Up / Down / Right | Command buttons |
| Recruit castle guard | Guard button at banner | D-pad Left at banner | Guard button |
| Guide | G or menu button | Menu | Guide button |

The controller must expose the browser's standard gamepad mapping. Press a controller button while the page is focused to make it visible to the browser. Use D-pad Up/Down and A for menu buttons; name/code text entry uses keyboard or touch. Controller-only base management: open the guide and use the camp-management buttons when near a friendly banner. Camera preference, look sensitivity, and vertical inversion are saved in your browser. Camera mode changes only local rendering, never server combat rules.

Hardware Xbox, Bluetooth, touch-device usability, camera clipping and visual layout still require human testing. Synthetic controller mapping tests passed. See docs/TEST-REPORT.md for exact verification boundaries.

## Deploy to Render

Play: https://swords-and-shrouds.onrender.com/

The source repository is https://github.com/neil-andrew-olson/swords-and-shrouds. Render Free in the homelab workspace is live. Deployment verification details are recorded in docs/TEST-REPORT.md.

Put the project source in a Git repository accessible to your Render account. Create a Node web service using:

- Build: `npm ci --include=dev && npm run build`
- Start: `npm start`
- Health check: `/health`
- Environment: `NODE_ENV=production`
- One instance; Free plan for the approved initial demonstration

`render.yaml` contains these settings. The process binds to 0.0.0.0 and Render's PORT environment variable. The browser connects to `/ws` on the same host using WSS on HTTPS. No client backend URL configuration is necessary.

Free services can sleep after 15 minutes of no inbound traffic and take about one minute to wake. Restarting, redeploying, or stopping the server loses in-memory campaigns. This release does not promise persistent saves or continuous availability. See https://render.com/docs/free and https://render.com/docs/websocket.

Do not deploy this ZIP as a static Netlify Drop site; the Node/WebSocket service is required.

## Architecture

TypeScript, Three.js rendering, Vite production build, Express HTTP, ws WebSockets. The server owns all gameplay and runs at 20 Hz. Clients receive snapshots at 10 Hz and interpolate movement. Browser inputs are sent at up to 20 Hz. The server enforces input bounds, range, cooldowns, room capacity, resource costs, and interaction rules.

`src/client` contains graphics, camera, controls and UI. `src/simulation` contains authoritative gameplay. `src/shared` contains world geometry and types. `src/server` owns sessions and room lifecycle. `tests` verifies simulation and real local WebSocket connections.

Rooms allow four humans, reserve disconnected identities for 60 seconds, pause when everyone disconnects, expire after five minutes empty, and retain finished results for ten minutes. Room codes are shareable invitations; private reconnect tokens stay in sessionStorage and are never in world snapshots. Deployment should use one server instance because rooms are in memory.

## Artwork and audio

Character and environment models include CC0 assets by Quaternius, Kay Lousberg and Kenney; see public/assets/CREDITS.txt. Procedural textures and synthesized audio are original. Three.js, Express, ws, Vite, TypeScript, tsx, and related packages retain their upstream licenses. The interface requests Cormorant Garamond and DM Sans from Google Fonts, with local serif/sans-serif fallbacks if unavailable.

## Current scope and limits

This is a publicly deployed first playable implementation. Public HTTPS, two-client WSS room joining, movement synchronization, and reconnect identity were verified. Visual and hardware playtesting remain outstanding. AI navigation uses simple castle-entrance waypoints; balancing, visual quality, physical controllers, low-end mobile performance, and a full human campaign need playtesting. No accounts, long-term saves, inventories, procedural terrain, PvP, or horizontal server scaling are implemented. Decorative scenery is not collidable; castle walls are collidable and prevent melee hits through them. Barricades/gates are defensive health pools; friendly knights pass under the raised gate.
