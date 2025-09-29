const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../../models/User');
const { createAuthToken, TOKEN_COOKIE_NAME, parseCookies } = require('../../utils/authTokens');

const isProduction = (process.env.NODE_ENV || 'development') === 'production';
const PRODUCTION_COOKIE_DOMAIN = 'cloaksgambit.bymarcell.com';

const router = express.Router();

const scopes = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

const FALLBACK_USERNAME = 'GoogleUser';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function buildCookieBaseOptions() {
  const base = {
    path: '/',
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
  };

  if (isProduction) {
    base.domain = PRODUCTION_COOKIE_DOMAIN;
  }

  return base;
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

    const tokenMaxAge = SESSION_MAX_AGE_MS;
    const token = createAuthToken(user);

    const cookieBase = { ...buildCookieBaseOptions(), maxAge: tokenMaxAge };

    const readableCookieOptions = {
      ...cookieBase,
      httpOnly: false,
    };

    const tokenCookieOptions = {
      ...cookieBase,
      httpOnly: true,
    };

    res.cookie('userId', user._id.toString(), readableCookieOptions);
    res.cookie('username', user.username, readableCookieOptions);
    res.cookie('photo', 'assets/images/cloakHood.jpg', readableCookieOptions);
    res.cookie(TOKEN_COOKIE_NAME, token, tokenCookieOptions);

    console.log('[auth] Issued session cookies for Google login', {
      userId: user._id.toString(),
      username: user.username,
      domain: tokenCookieOptions.domain || null,
      sameSite: tokenCookieOptions.sameSite,
      secure: tokenCookieOptions.secure,
      maxAge: tokenCookieOptions.maxAge,
    });
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Authentication failed' });
  }
});

router.post('/logout', (req, res) => {
  const baseOptions = buildCookieBaseOptions();
  const readableOptions = { ...baseOptions };
  const tokenOptions = { ...baseOptions, httpOnly: true };

  res.clearCookie('userId', readableOptions);
  res.clearCookie('username', readableOptions);
  res.clearCookie('photo', readableOptions);
  res.clearCookie(TOKEN_COOKIE_NAME, tokenOptions);

  const cookies = parseCookies(req?.headers?.cookie);

  console.log('[auth] Cleared session cookies for logout', {
    hadToken: Boolean(cookies && cookies[TOKEN_COOKIE_NAME]),
    hadUserId: Boolean(cookies && cookies.userId),
    domain: tokenOptions.domain || null,
    sameSite: tokenOptions.sameSite,
    secure: tokenOptions.secure,
  });

  res.status(204).end();
});

module.exports = router;
