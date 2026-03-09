# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Node.js API code (entry point: `src/server.js`), organized by `config/`, `models/`, `routes/`, `services/`, `state/`, and `utils/`.
- `shared/`: Cross-runtime game logic and constants used by server, bots, and browser artifacts.
- `public/`: Static assets and browser-consumable files.
- `tests/`: Jest test suite (`*.test.js`) for shared constants, utility behavior, and integration-facing logic.
- `scripts/`: Build and maintenance scripts (for example `build-shared-constants.js` and migrations).
- `docs/`: API and UI documentation; refer to `docs/colors.md` for color token usage.
- `ml_backend/`: Separate Python/ML workspace; treat as independent from the Node API runtime.

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
- There is no enforced coverage gate; aim for meaningful assertions on changed paths.

## Commit & Pull Request Guidelines
- Prefer short, imperative commit subjects (for example `Fix speech bubbles for bot moves and bombs`).
- Keep commits scoped to one logical change and include related tests.
- PRs should include: what changed, why, test evidence (`npm test` output), and linked issue/task.
- Include screenshots or payload examples when changing `public/` UI behavior or API response shape.

## Security & Configuration Tips
- Copy `.env.example` to `.env.development` for local work; never commit secret-bearing `.env*` files.
- In production, provide secrets via environment variables (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `MONGODB_ATLAS_CONNECTION_STRING`).

# ExecPlans
When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.