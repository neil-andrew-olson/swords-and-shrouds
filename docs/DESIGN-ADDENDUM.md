# Approved additions

The user approved the design and requested Xbox controller support plus optional first-person / third-person switching. The presentation therefore changes from a strictly top-down 2D canvas to a 3D world rendered with Three.js, simple low-poly medieval models, and procedural low-resolution textures. The original campaign rules and authoritative Node/WebSocket architecture remain.

Camera switching is explicit: V, Xbox Y, or the View button. Combat never forces a camera. Both cameras share movement, targeting, sword range, cooldowns, collision and damage. Desktop uses pointer lock; touch and controller camera movement do not require pointer lock. Third-person camera raycasts against castle walls/towers. First-person hides the local body and displays a sword/shield. Preferences persist locally.

Xbox support polls the standard Gamepad API each animation frame. Sticks use an 18% deadzone. Y is edge-triggered, so holding it does not rapidly toggle. RT/RB attacks, LT blocks, A interacts, X heals, Menu opens the guide, and D-pad commands troops. Inputs stop when the tab loses focus or the controller disconnects. Hardware confirmation remains outstanding.
