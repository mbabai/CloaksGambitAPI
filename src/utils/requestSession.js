const User = require('../models/User');
const ensureUser = require('./ensureUser');
const { buildAuthCookieOptions } = require('./authCookies');
const {
  createAuthToken,
  TOKEN_COOKIE_NAME,
  extractTokenFromRequest,
  resolveUserFromToken,
  parseCookies,
} = require('./authTokens');

const FALLBACK_USERNAME = 'GoogleUser';
const GUEST_EMAIL_REGEX = /@guest\.local$/i;

function clearCookie(res, name, baseOptions = {}) {
  if (!res || typeof res.cookie !== 'function') return;
  res.cookie(name, '', {
    ...baseOptions,
    maxAge: 0,
    expires: new Date(0),
  });
}

function applyAuthenticatedCookies(req, res, user, token = createAuthToken(user)) {
  const options = buildAuthCookieOptions(req);
  const userId = user?._id ? user._id.toString() : '';
  const username = user?.username || FALLBACK_USERNAME;
  const photo = user?.photoUrl || '/assets/images/cloakHood.jpg';

  if (userId) {
    res.cookie('userId', userId, options);
  } else {
    clearCookie(res, 'userId', options);
  }
  res.cookie('username', username, options);
  res.cookie('photo', photo, options);
  res.cookie(TOKEN_COOKIE_NAME, token, { ...options, httpOnly: true });
}

function applyGuestCookies(req, res, guestInfo) {
  const options = buildAuthCookieOptions(req);
  const userId = guestInfo?.userId ? String(guestInfo.userId) : '';
  const username = guestInfo?.username || FALLBACK_USERNAME;
  res.cookie('userId', userId, options);
  res.cookie('username', username, options);
  clearCookie(res, 'photo', options);
  clearCookie(res, TOKEN_COOKIE_NAME, { ...options, httpOnly: true });
}

function hasRecoverableAuthenticatedUser(user) {
  if (!user) return false;
  if (user.isBot) return true;
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  return Boolean(email) && !GUEST_EMAIL_REGEX.test(email);
}

async function repairAuthenticatedUser(user) {
  if (!user) return user;
  if (user.isGuest) {
    user.isGuest = false;
    if (typeof user.save === 'function') {
      await user.save();
    } else {
      await User.updateOne({ _id: user._id }, { $set: { isGuest: false } });
    }
  }
  return user;
}

function normalizeResolvedUser(resolved) {
  if (!resolved?.userId) return null;
  return {
    type: resolved.isGuest ? 'guest' : 'authenticated',
    authenticated: !resolved.isGuest,
    userId: resolved.userId,
    username: resolved.username || FALLBACK_USERNAME,
    email: resolved.email || '',
    isGuest: Boolean(resolved.isGuest),
    user: resolved.user || null,
  };
}

function normalizeInjectedSession(session) {
  if (!session?.userId) return null;
  return {
    type: session.isGuest ? 'guest' : 'authenticated',
    authenticated: Boolean(session.authenticated && !session.isGuest),
    userId: String(session.userId),
    username: session.username || FALLBACK_USERNAME,
    email: session.email || '',
    isGuest: Boolean(session.isGuest),
    user: session.user || null,
  };
}

async function resolveGuestFromCookieUser(cookieUserId) {
  if (!cookieUserId) return null;

  if (process.env.NODE_ENV !== 'production') {
    const localUser = await User.findById(cookieUserId).catch(() => null);
    if (hasRecoverableAuthenticatedUser(localUser)) {
      const repaired = await repairAuthenticatedUser(localUser);
      return {
        type: 'authenticated',
        authenticated: true,
        userId: repaired._id.toString(),
        username: repaired.username || FALLBACK_USERNAME,
        email: repaired.email || '',
        isGuest: false,
        user: repaired,
      };
    }
  }

  const ensured = await ensureUser(cookieUserId);
  if (!ensured?.userId) return null;
  return {
    type: 'guest',
    authenticated: false,
    userId: ensured.userId,
    username: ensured.username || FALLBACK_USERNAME,
    email: '',
    isGuest: Boolean(ensured.isGuest),
    user: null,
  };
}

async function resolveSessionFromRequest(req, options = {}) {
  const { createGuest = false } = options;
  const injected = normalizeInjectedSession(req?.__resolvedSession);
  if (injected) {
    return injected;
  }
  const token = extractTokenFromRequest(req);

  if (token) {
    try {
      const resolved = await resolveUserFromToken(token);
      const normalized = normalizeResolvedUser(resolved);
      if (normalized) {
        if (normalized.authenticated && normalized.user) {
          normalized.user = await repairAuthenticatedUser(normalized.user);
          normalized.isGuest = false;
          normalized.type = 'authenticated';
          normalized.authenticated = true;
        }
        return normalized;
      }
    } catch (err) {
      console.warn('Failed to resolve session from token', err);
    }
  }

  const cookies = parseCookies(req?.headers?.cookie);
  const cookieUserId = cookies?.userId;
  if (cookieUserId) {
    try {
      const resolvedFromCookie = await resolveGuestFromCookieUser(cookieUserId);
      if (resolvedFromCookie) {
        return resolvedFromCookie;
      }
    } catch (err) {
      console.warn('Failed to resolve session from cookie userId', err);
    }
  }

  if (!createGuest) {
    return null;
  }

  const guest = await ensureUser();
  return {
    type: 'guest',
    authenticated: false,
    userId: guest.userId,
    username: guest.username || FALLBACK_USERNAME,
    email: '',
    isGuest: true,
    user: null,
  };
}

function buildSocketRequestFromHandshake(handshake = {}) {
  const headers = { ...(handshake.headers || {}) };
  const token = handshake?.auth?.token;
  if (token && !headers.authorization) {
    headers.authorization = `Bearer ${token}`;
  }
  return { headers };
}

async function resolveSessionFromSocketHandshake(handshake, options = {}) {
  const req = buildSocketRequestFromHandshake(handshake);
  return resolveSessionFromRequest(req, options);
}

module.exports = {
  FALLBACK_USERNAME,
  applyAuthenticatedCookies,
  applyGuestCookies,
  clearCookie,
  hasRecoverableAuthenticatedUser,
  repairAuthenticatedUser,
  resolveSessionFromRequest,
  resolveSessionFromSocketHandshake,
};
