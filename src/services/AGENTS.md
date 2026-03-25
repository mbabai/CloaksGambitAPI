# Service Notes

## What This Layer Owns
- `game/liveGameRules.js`: shared pending-move legality and resolution helpers for live HTTP routes.
- `matches/activeMatches.js`: normalizes active/history match payloads for APIs, spectating, and admin views.
- `history/summary.js`: derives match/game history summary data.
- `bots/`: bot user registration plus internal bot startup.
- `guestCleanup.js`: scheduled deletion of stale guest users.

## Match and History Helpers
- `matches/activeMatches.js` exists because active matches, completed matches, and frontend payloads are not all shaped identically.
- The normalization logic is intentionally defensive around ids and score fields. Keep that flexibility unless you also simplify every caller.

## Bots
- `bots/registry.js` ensures durable bot users and creates auth tokens for them.
- `bots/internalBots.js` launches socket-connected internal bot clients after the server starts listening.
- Shared bot behavior lives under `shared/bots/`, not only here.

## Guest Cleanup
- `guestCleanup.js` deletes guest users whose `lastDisconnectedAt` is older than 24 hours.
- The cleanup now skips any guest record still referenced by a live or historical `Game`/`Match`, so active boards and history views keep stable player identities.
- Startup begins the cleanup loop only after the database connection succeeds.

## Change Discipline
- If you extract more route logic into services, preserve the existing tests or add new ones before deleting duplicated behavior from the routes.
