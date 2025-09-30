const jwt = require('jsonwebtoken');
const User = require('../models/User');

const DEFAULT_SECRET = 'development-secret-change-me';
const TOKEN_COOKIE_NAME = 'cgToken';
const TOKEN_HEADER = 'authorization';

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_SECRET;
}

function createAuthToken(user) {
  if (!user) throw new Error('User is required to create an auth token');
  const payload = {
    sub: user._id.toString(),
    username: user.username || null,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '365d' });
}

function verifyAuthToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (err) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [rawKey, ...rawVal] = part.trim().split('=');
    if (!rawKey) return acc;
    const key = decodeURIComponent(rawKey);
    const value = decodeURIComponent(rawVal.join('=') || '');
    acc[key] = value;
    return acc;
  }, {});
}

function extractTokenFromRequest(req) {
  if (!req || typeof req !== 'object') return null;

  const header = req.headers?.[TOKEN_HEADER];
  if (typeof header === 'string') {
    const parts = header.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      return parts[1];
    }
    if (!header.includes(' ')) {
      // Allow sending raw token without Bearer prefix for flexibility
      return header.trim();
    }
  }

  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[TOKEN_COOKIE_NAME]) {
      return cookies[TOKEN_COOKIE_NAME];
    }
  }

  return null;
}

async function resolveUserFromToken(token) {
  const payload = verifyAuthToken(token);
  if (!payload?.sub) {
    return null;
  }

  const user = await User.findById(payload.sub).lean();
  if (!user) {
    return null;
  }

  const userId = user._id.toString();
  const username = user.username || 'Anonymous';
  const email = user.email || '';
  const isGuest = email.endsWith('@guest.local');

  return {
    userId,
    username,
    email,
    isGuest,
    user,
  };
}

async function resolveUserFromRequest(req) {
  const token = extractTokenFromRequest(req);
  if (!token) return null;
  return resolveUserFromToken(token);
}

module.exports = {
  TOKEN_COOKIE_NAME,
  createAuthToken,
  parseCookies,
  extractTokenFromRequest,
  resolveUserFromRequest,
  resolveUserFromToken,
  verifyAuthToken,
};
