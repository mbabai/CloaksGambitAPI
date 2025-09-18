# Shared game constants

The canonical values used to seed and validate server configuration live in [`shared/constants/game.json`](../shared/constants/game.json). The JSON document is the single source of truth for game modes, colors, identities, move states, and other enumerations that were previously duplicated across models and utilities.

## Runtime entry points

Consumers can load the dataset from either module system without duplicating logic:

- **CommonJS** modules should `require('../../shared/constants')` (adjust the relative path as needed) to receive an immutable object that exposes `GAME_CONSTANTS` as well as named helpers like `gameModes`, `colors`, and `gameModeSettings`.
- **ES modules** can `import` from `shared/constants/index.mjs`, which uses `createRequire` internally to load the same JSON and re-export the frozen payload.

Both entry points deep-freeze the shared structure so runtime code cannot accidentally mutate the defaults. When a writable copy is required (for example when seeding Mongoose documents) clone the data first, e.g. `JSON.parse(JSON.stringify(GAME_CONSTANTS))`.

## Extending the constants

To add or update a constant:

1. Modify `shared/constants/game.json`. Keep values camel-cased/pascal-cased to match existing keys and preserve numeric encodings used by the database.
2. Confirm the change is surfaced automatically via the CommonJS and ESM wrappers. No additional updates are needed unless new top-level keys should have dedicated named exports.
3. Update any documentation or application logic that depends on the new key.

Following this pattern keeps the configuration defaults centralized and prevents drift between the database schema, runtime utilities, and API responses.
