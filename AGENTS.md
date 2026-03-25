# Repository Guidelines

## Documentation Map
- `rules.md`: canonical long-form rules text plus codebase implementation notes.
- `src/AGENTS.md`: server boot flow, MongoDB connection behavior, socket/auth overview.
- `src/routes/AGENTS.md`: route layout, queue/auth expectations, and write-route patterns.
- `src/routes/auth/AGENTS.md`: Google OAuth, session recovery, and cookie/JWT behavior.
- `src/routes/v1/gameAction/AGENTS.md`: live rules state machine for setup, move, bomb, challenge, pass, and on-deck.
- `src/models/AGENTS.md`: hybrid in-memory/live-state plus Mongo history persistence model.
- `src/services/AGENTS.md`: shared live rules helpers, bots, history, and matchmaking support.
- `src/utils/AGENTS.md`: server config cache, auth helpers, guest handling, masking, and clock authority.
- `public/AGENTS.md`: browser boot flow, auth/session sync, sockets, and modularization status.
- `shared/AGENTS.md`: shared constants pipeline and shared bot runtime.
- `tests/AGENTS.md`: current Jest strategy and the highest-signal regression suites.
- `docs/AGENTS.md`: doc folder intent and the recent refactor records worth reading first.

## Architecture Snapshot
- Express serves the REST API, HTML shells, static assets, and Socket.IO from the same Node process in `src/server.js`.
- Live `Game` and `Match` records are stored in memory while active. Completed games and matches are persisted to MongoDB history collections. `User` and `ServerConfig` stay Mongo-backed throughout.
- Auth is hybrid: Google OAuth creates a long-lived JWT plus readable identity cookies, while guests are created automatically for non-ranked flows. The frontend repairs session state through `/api/auth/session`.
- Server-authored `game.clockState` is now the live clock source of truth. Clients and spectators should consume the `clocks` payload from sockets instead of inferring time from raw actions when a snapshot exists.
- Recent refactors to understand before editing:
  - `src/routes/auth/google.js` and `src/utils/ensureUser.js` now repair local authenticated sessions and prevent real users from being downgraded into guest accounts.
  - `src/server.js` no longer rewrites Atlas URIs. Production uses the raw `MONGODB_ATLAS_CONNECTION_STRING`, applies `dbName: 'cloaksgambit'`, and retries once with `authSource=admin` if needed.
  - `src/utils/gameClock.js`, `src/models/Game.js`, `src/socket.js`, and the browser clock helpers now use stored server clock state instead of replay-only authority.

## Project Structure & Module Organization
- `src/`: Node.js API code (entry point: `src/server.js`), organized by `config/`, `models/`, `routes/`, `services/`, `state/`, and `utils/`.
- `shared/`: Cross-runtime game logic and constants used by server, bots, and browser artifacts.
- `public/`: Static assets and browser-consumable files.
- `tests/`: Jest test suite (`*.test.js`) for shared constants, utility behavior, and integration-facing logic.
- `scripts/`: Build and maintenance scripts (for example `build-shared-constants.js` and migrations).
- `docs/`: API and UI documentation; refer to `docs/colors.md` for color token usage.

## Build, Test, and Development Commands
- `npm install`: Install Node dependencies.
- `npm run build:shared`: Regenerate shared browser constants from `shared/constants/game.json`.
- `npm run dev`: Rebuild shared constants and run the API with `nodemon`.
- `npm start`: Production-style startup (`build:shared` + `node src/server.js`).
- `npm test`: Rebuild shared constants, then run Jest with Node VM modules enabled.
- `npm run migrate:guests`: Execute guest-account migration script.

## Coding Style & Naming Conventions
- Use CommonJS (`require`/`module.exports`) in server code.
- Follow existing formatting: 2-space indentation, semicolons, single quotes.
- Use `PascalCase` for Mongoose model files (for example `src/models/Game.js`) and `camelCase` for utilities/services.
- Keep tests in `tests/` and name them `<feature>.test.js`.
- No dedicated lint/formatter config is committed; match nearby code style and keep diffs minimal.

## Testing Guidelines
- Framework: Jest (`jest` + `supertest` available in dev dependencies).
- Add or update tests for each behavior change, especially in routes, shared constants, and bot logic.
- Run full suite with `npm test`; run a focused file with `npm test -- tests/sharedGameConstants.test.js`.
- Do not use port `3000` for test runs or local verification started by the agent; treat `3000` as reserved for the user's active app session and use another port such as `3100`.
- On Windows in the Codex desktop terminal, do not invoke `nvm` for version switching because it can trigger GUI popups instead of returning terminal output. For cross-version validation, prefer running the target runtime directly, for example `npx -p node@24 node ...`.
- When giving Azure CLI commands for Cloud Shell or portal terminals, prefer single-line commands without shell continuations because pasted multiline commands may fail depending on the shell surface.
- There is no enforced coverage gate; aim for meaningful assertions on changed paths.

## Commit & Pull Request Guidelines
- Prefer short, imperative commit subjects (for example `Fix speech bubbles for bot moves and bombs`).
- Keep commits scoped to one logical change and include related tests.
- PRs should include: what changed, why, test evidence (`npm test` output), and linked issue/task.
- Include screenshots or payload examples when changing `public/` UI behavior or API response shape.

## Security & Configuration Tips
- Copy `.env.example` to `.env.development` for local work; never commit secret-bearing `.env*` files.
- In production, provide secrets via environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `MONGODB_ATLAS_CONNECTION_STRING`).
- Preserve `app.set('trust proxy', true)` in `src/server.js`; OAuth redirect resolution depends on forwarded host/protocol when running behind a proxy.
- If you change auth cookie semantics or token transport, update both the server helpers and the browser token sync in `public/index.js` and `public/js/modules/api/game.js`.
- If you change the live rules, update `rules.md` and the route-level regression tests at the same time.

# ExecPlans
When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.
