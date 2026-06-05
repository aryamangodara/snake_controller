# Firebase Schema & Rules

The game uses a **hybrid** Firebase backend. Rules for both databases live in version control and
are deployed by CI (`firebase deploy --only hosting,firestore,database`). See
`.agent/workflows/deploy.md`.

## Firestore — session metadata & game state
Collection `sessions/{code}` where `{code}` is a 6-digit string. One document per active session:

| Field          | Type      | Written by | Notes                                            |
|----------------|-----------|------------|--------------------------------------------------|
| `created`      | timestamp | desktop    | server timestamp at creation                     |
| `connected`    | boolean   | both       | desktop sets false on create; mobile sets true   |
| `gameState`    | map       | desktop    | `{ active, score, state }`                        |
| `gameAction`   | string    | mobile     | `start` / `restart`; desktop clears it to `null` |
| `lastActivity` | timestamp | both       | server timestamp; touched on each write          |
| `version`      | number    | desktop    | debug marker                                      |

Rules (`firestore.rules`): reads/deletes require a 6-digit `{code}`; creates/updates additionally
require the document to contain only the keys above. All other collections are denied. There is no
auth yet, so access is path/shape-scoped, not per-user. If Anonymous Auth is added, store an
`ownerId` on create and require `request.auth.uid == ownerId`.

## Realtime Database — joystick stream
Path `controllers/{code}`. High-frequency input, kept out of Firestore to avoid write costs:

| Field         | Type    | Notes                                            |
|---------------|---------|--------------------------------------------------|
| `connected`   | boolean |                                                  |
| `joystick`    | map     | `{ x, y }`, each a number in roughly [-1, 1]     |
| `timestamp`   | number  | `ServerValue.TIMESTAMP`                          |
| `initialized` | boolean | set by desktop on create                         |

Rules (`database.rules.json`): read/write require a 6-digit `{code}`; child `.validate` rules
enforce the shape and the joystick range; unknown keys are rejected.

## Cleanup / lifecycle
Sessions are ephemeral. The desktop host registers `onDisconnect().remove()` on its RTDB node and
best-effort-deletes the Firestore doc + RTDB node on `beforeunload`. For guaranteed Firestore
cleanup, configure a **TTL policy** on the `lastActivity` field (Firebase console → Firestore →
TTL) so abandoned sessions expire automatically.
