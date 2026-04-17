# Firebase Schema & Rules

> [!NOTE]
> Currently, the project appears to primarily use Firebase Hosting. Below are details outlining how data is structured if/when Realtime Database or Firestore are utilized.

## Database Rules (Realtime Database)
The raw rules file is stored in `database.rules.json` at the root.

```json
{
  "rules": {
    ".read": "now < 1714070400000",
    ".write": "now < 1714070400000"
  }
}
```
Currently configured in test mode. These rules need to be updated to a secure structure to prevent unauthorized access if leaderboards or user auth are scaled up.

## Data Schema (Hypothetical / Planned)
If a leaderboard is implemented:
- `users/$uid`: `{ username: string, highScore: number }`
- `leaderboard`: Sorted view or query mapping directly to user high scores.
