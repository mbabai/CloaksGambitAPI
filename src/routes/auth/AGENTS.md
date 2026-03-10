# Auth Route Notes

## Current Auth Stack
- Google OAuth starts at `GET /api/auth/google`.
- OAuth callback handling, user creation/update, and cookie minting happen in `GET /api/auth/google/callback`.
- Session repair happens in `GET /api/auth/session`.
- Logging out demotes the session back to a fresh guest through `POST /api/auth/logout`.

## Token and Cookie Model
- `createAuthToken()` in `src/utils/authTokens.js` signs a long-lived JWT whose `sub` is the Mongo user id.
- The route sets:
  - `userId`
  - `username`
  - `photo`
  - `cgToken`
- `cgToken` is intentionally readable by browser JavaScript (`httpOnly: false`) because the current client copies it into `localStorage['cg_token']` for `fetch()` headers and Socket.IO auth. Do not change that casually.
- Cookie flags come from `src/utils/authCookies.js` and the env vars:
  - `AUTH_COOKIE_SAME_SITE`
  - `AUTH_COOKIE_SECURE`
  - `AUTH_COOKIE_DOMAIN`

## Redirect and Proxy Behavior
- `resolveRedirectUri()` prefers `GOOGLE_REDIRECT_URI`.
- If that env var is absent, the route derives the origin from forwarded host/proto headers or the request host.
- This is why `app.set('trust proxy', true)` in `src/server.js` matters for production OAuth behind a reverse proxy.

## Recent Session Refactor
- `GET /session` now resolves auth in this order:
  1. JWT from `Authorization` header or `cgToken` cookie.
  2. Development-only recovery from `userId` cookie when that cookie belongs to a real account.
  3. Guest fallback through `ensureUser()`.
- The recovery step also repairs bad `isGuest` flags on real users and bots.
- `ensureUser()` was updated at the same time so real-email accounts are preserved instead of normalized into guest data.

## Frontend Contract
- The browser expects `/session` to return `userId`, `username`, `isGuest`, and `authenticated`.
- Login/logout also needs to keep the browser's cookie/localStorage token sync working in `public/index.js`.

## Required Test Coverage
- If you change session recovery, cookie naming, token extraction, or guest fallback, update:
  - `tests/googleAuth.session.test.js`
  - `tests/ensureUser.test.js`
  - any affected queue/auth route tests
