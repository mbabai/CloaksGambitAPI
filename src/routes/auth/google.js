const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { isProduction } = require('../../config/loadEnv');
const User = require('../../models/User');
const ensureUser = require('../../utils/ensureUser');
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
const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;

function buildCookieOptions() {
  const base = {
    maxAge: ONE_YEAR_MS,
    sameSite: 'lax',
  };
  return isProduction ? { ...base, secure: true } : base;
}

function clearCookie(res, name, baseOptions = {}) {
  res.cookie(name, '', { ...baseOptions, maxAge: 0 });
}

function applyAuthenticatedCookies(res, user, token) {
  const options = buildCookieOptions();
  const userId = user._id.toString();
  const username = user.username || FALLBACK_USERNAME;
  const photo = user.photoUrl || 'assets/images/cloakHood.jpg';

  if (userId) {
    res.cookie('userId', userId, options);
  } else {
    clearCookie(res, 'userId', options);
  }
  res.cookie('username', username, options);
  res.cookie('photo', photo, options);
  res.cookie(TOKEN_COOKIE_NAME, token, { ...options, httpOnly: false });
}

function applyGuestCookies(res, guestInfo) {
  const options = buildCookieOptions();
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

function resolveRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  // Fallback for dev/local
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}/api/auth/google/callback`;
}

router.get('/google', (req, res) => {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    return res.status(500).json({ message: 'Google OAuth is not configured' });
  }
  const redirectUri = resolveRedirectUri(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ message: 'Missing authorization code' });
  }

  try {
    const clientId = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();

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
    applyAuthenticatedCookies(res, user, token);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Authentication failed' });
  }
});

router.get('/session', async (req, res) => {
  try {
    const session = await resolveSessionFromRequest(req);
    if (session.type === 'authenticated' && !session.isGuest) {
      const token = createAuthToken(session.user);
      applyAuthenticatedCookies(res, session.user, token);
      return res.json({
        userId: session.userId,
        username: session.username,
        email: session.user?.email || '',
        isGuest: false,
        authenticated: true,
      });
    }

    applyGuestCookies(res, session);
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
    applyGuestCookies(res, guest);
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
