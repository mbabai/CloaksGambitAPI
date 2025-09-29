const jwt = require('jsonwebtoken');
const User = require('../models/User');

const DEFAULT_SECRET = 'development-secret-change-me';
const TOKEN_COOKIE_NAME = 'cgToken';
const TOKEN_HEADER = 'authorization';
const TOKEN_EXPIRATION = '7d';

function buildLogContext(req) {
  if (!req || typeof req !== 'object') {
    return {};
  }

  const context = {};
  const url = req.originalUrl || req.url;
  if (url) {
    context.url = url;
  }

  const headerForwarded = req.headers?.['x-forwarded-for'];
  if (headerForwarded) {
    context.ip = Array.isArray(headerForwarded) ? headerForwarded[0] : headerForwarded;
  } else if (req.ip) {
    context.ip = req.ip;
  }

  return context;
}

function getJwtSecret() {
  return process.env.JWT_SECRET || DEFAULT_SECRET;
}

function createAuthToken(user) {
  if (!user) throw new Error('User is required to create an auth token');
  const payload = {
    sub: user._id.toString(),
    username: user.username || null,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRATION });
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
      console.log('[auth] Resolved auth token from Authorization header', buildLogContext(req));
      return parts[1];
    }
    if (!header.includes(' ')) {
      // Allow sending raw token without Bearer prefix for flexibility
      console.log('[auth] Resolved auth token from Authorization header (raw token)', buildLogContext(req));
      return header.trim();
    }
  }

  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const cookies = parseCookies(cookieHeader);
    if (cookies[TOKEN_COOKIE_NAME]) {
      console.log('[auth] Resolved auth token from cookie', buildLogContext(req));
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
  extractTokenFromRequest,
  parseCookies,
  resolveUserFromRequest,
  resolveUserFromToken,
  verifyAuthToken,
};
