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
| `feedback`     | map       | desktop    | `{ type, at }` one-shot haptic cue for the phone  |

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

## Security model & accepted risks
There is **no authentication** — access is scoped by path shape (6-digit code) and document
shape, not identity. The following risks are **known and accepted** for this project's scale:

- **Session griefing:** anyone who guesses/enumerates an active 6-digit code can read the
  session, inject joystick input, send start/restart actions, or delete the session doc. The
  open `delete` grant cannot be removed — the host's own `beforeunload` cleanup depends on it.
  Impact is annoyance only; no user data is at stake.
- **Leaderboard spoofing:** writes are shape/range-validated and monotonic, but any client can
  submit an in-range fake score or create rows under arbitrary device ids.

**Mitigations (console-side, owner action):** Firestore TTL on `sessions.lastActivity`, a
billing **budget alert** as the cost tripwire, and — if real traffic ever arrives — Firebase
**App Check** plus Anonymous Auth with an `ownerId` on session create.
