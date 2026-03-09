const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../../models/User');
const ensureUser = require('../../utils/ensureUser');
const { buildAuthCookieOptions } = require('../../utils/authCookies');
const {
  createAuthToken,
  TOKEN_COOKIE_NAME,
  extractTokenFromRequest,
  resolveUserFromToken,
  parseCookies,
} = require('../../utils/authTokens');

const router = express.Router();

const scopes = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

const FALLBACK_USERNAME = 'GoogleUser';
const DEFAULT_RETURN_TO = '/';

function clearCookie(res, name, baseOptions = {}) {
  res.cookie(name, '', {
    ...baseOptions,
    maxAge: 0,
    expires: new Date(0),
  });
}

function applyAuthenticatedCookies(req, res, user, token) {
  const options = buildAuthCookieOptions(req);
  const userId = user._id.toString();
  const username = user.username || FALLBACK_USERNAME;
  const photo = user.photoUrl || '/assets/images/cloakHood.jpg';

  if (userId) {
    res.cookie('userId', userId, options);
  } else {
    clearCookie(res, 'userId', options);
  }
  res.cookie('username', username, options);
  res.cookie('photo', photo, options);
  res.cookie(TOKEN_COOKIE_NAME, token, { ...options, httpOnly: false });
}

function applyGuestCookies(req, res, guestInfo) {
  const options = buildAuthCookieOptions(req);
  const userId = guestInfo.userId ? String(guestInfo.userId) : '';
  const username = guestInfo.username || FALLBACK_USERNAME;
  res.cookie('userId', userId, options);
  res.cookie('username', username, options);
  clearCookie(res, 'photo', options);
  clearCookie(res, TOKEN_COOKIE_NAME, { ...options, httpOnly: false });
}

async function resolveSessionFromRequest(req) {
  const token = extractTokenFromRequest(req);
  if (token) {
    try {
      const resolved = await resolveUserFromToken(token);
      if (resolved?.user) {
        return {
          type: 'authenticated',
          token,
          user: resolved.user,
          userId: resolved.userId,
          username: resolved.username,
          isGuest: resolved.isGuest,
        };
      }
    } catch (err) {
      console.warn('Failed to resolve user from token', err);
    }
  }

  const cookies = parseCookies(req.headers?.cookie);
  const cookieUserId = cookies?.userId;
  if (cookieUserId) {
    try {
      const ensured = await ensureUser(cookieUserId);
      if (ensured && ensured.isGuest) {
        return { type: 'guest', ...ensured };
      }
    } catch (err) {
      console.warn('Failed to reuse cookie userId', err);
    }
  }

  const guest = await ensureUser();
  return { type: 'guest', ...guest };
}

function sanitizeSegment(segment) {
  if (!segment) return '';
  return segment
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');
}

async function buildUsernameFromProfile(payload = {}) {
  const candidates = [
    payload.name,
    payload.given_name && payload.family_name
      ? `${payload.given_name}${payload.family_name}`
      : payload.given_name,
    payload.email ? payload.email.split('@')[0] : undefined,
    FALLBACK_USERNAME
  ];

  let base = '';
  for (const candidate of candidates) {
    const sanitized = sanitizeSegment(candidate);
    if (sanitized.length >= 3) {
      base = sanitized.slice(0, 18);
      break;
    }
    if (!base && sanitized.length > 0) {
      base = sanitized;
    }
  }

  if (!base) {
    base = FALLBACK_USERNAME;
  }

  if (base.length < 3) {
    base = (base + FALLBACK_USERNAME).slice(0, Math.max(3, base.length));
  }

  base = base.slice(0, 18);

  let username = base;
  let suffix = 0;

  while (await User.exists({ username })) {
    suffix += 1;
    const suffixStr = suffix.toString();
    const available = Math.max(18 - suffixStr.length, 1);
    const trimmedBase = base.slice(0, available) || FALLBACK_USERNAME.slice(0, available);
    username = `${trimmedBase}${suffixStr}`;
  }

  return username;
}

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID;
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET;
}

function getRequestOrigin(req) {
  const forwardedProtoHeader = req.headers?.['x-forwarded-proto'];
  const forwardedHostHeader = req.headers?.['x-forwarded-host'];
  const protoCandidate = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const hostCandidate = Array.isArray(forwardedHostHeader)
    ? forwardedHostHeader[0]
    : forwardedHostHeader;
  const protocol = String(protoCandidate || req.protocol || 'http').split(',')[0].trim();
  const host = String(hostCandidate || req.get('host') || '').split(',')[0].trim();
  if (!host) return null;
  return `${protocol}://${host}`;
}

function resolveRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const origin = getRequestOrigin(req);
  if (origin) {
    return `${origin}/api/auth/google/callback`;
  }
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api/auth/google/callback`;
}

function sanitizeReturnTo(value) {
  if (typeof value !== 'string') return DEFAULT_RETURN_TO;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return DEFAULT_RETURN_TO;
  }
  return trimmed;
}

function encodeOAuthState(payload = {}) {
  try {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  } catch (err) {
    return '';
  }
}

function decodeOAuthState(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
}

router.get('/google', (req, res) => {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: 'Google OAuth is not configured' });
  }
  const returnTo = sanitizeReturnTo(req.query?.returnTo);
  const state = encodeOAuthState({ returnTo });
  const redirectUri = resolveRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ message: 'Missing authorization code' });
  }

  try {
    res.set('Cache-Control', 'no-store');
    const clientId = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();
    const state = decodeOAuthState(req.query?.state);
    const returnTo = sanitizeReturnTo(state?.returnTo);

    if (!clientId || !clientSecret) {
      return res.status(500).json({ message: 'Google OAuth is not configured' });
    }
    const redirectUri = resolveRedirectUri(req);
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);

    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const photoUrl = payload.picture;

    if (!email) {
      throw new Error('Google profile did not return an email address');
    }

    let user = await User.findOne({ email });
    if (!user) {
      let username = await buildUsernameFromProfile(payload);
      while (!user) {
        try {
          user = await User.create({ username, email, photoUrl });
        } catch (creationErr) {
          if (creationErr?.code === 11000 && creationErr.keyPattern) {
            if (creationErr.keyPattern.email) {
              user = await User.findOne({ email });
              if (user) break;
            }
            if (creationErr.keyPattern.username) {
              username = await buildUsernameFromProfile(payload);
              continue;
            }
          }
          throw creationErr;
        }
      }
    } else {
      user.photoUrl = photoUrl;
      await user.save();
    }

    const token = createAuthToken(user);
    applyAuthenticatedCookies(req, res, user, token);
    res.redirect(returnTo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Authentication failed' });
  }
});

router.get('/session', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const session = await resolveSessionFromRequest(req);
    if (session.type === 'authenticated' && !session.isGuest) {
      const token = createAuthToken(session.user);
      applyAuthenticatedCookies(req, res, session.user, token);
      return res.json({
        userId: session.userId,
        username: session.username,
        email: session.user?.email || '',
        isGuest: false,
        authenticated: true,
      });
    }

    applyGuestCookies(req, res, session);
    return res.json({
      userId: session.userId,
      username: session.username,
      email: null,
      isGuest: true,
      authenticated: false,
    });
  } catch (err) {
    console.error('Failed to resolve session', err);
    res.status(500).json({ message: 'Failed to resolve session' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const guest = await ensureUser();
    applyGuestCookies(req, res, guest);
    res.json({
      userId: guest.userId,
      username: guest.username,
      isGuest: true,
      authenticated: false,
    });
  } catch (err) {
    console.error('Failed to log out user', err);
    res.status(500).json({ message: 'Failed to log out' });
  }
});

module.exports = router;
