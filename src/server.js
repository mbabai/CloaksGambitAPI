const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const { NODE_ENV, isProduction } = require('./config/loadEnv');
const { DEFAULT_DEV_PORT, DEFAULT_DEV_PORT_SEARCH_LIMIT } = require('./config/defaults');
const { bindServerPort } = require('./utils/listenPort');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ATLAS_DB_NAME = 'cloaksgambit';
const MONGODB_ATLAS_URI = process.env.MONGODB_ATLAS_CONNECTION_STRING;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ASSET_VERSION_TOKEN = '__ASSET_VERSION__';
const APP_ASSET_VERSION = String(
  process.env.ASSET_VERSION
    || process.env.GITHUB_SHA
    || Date.now()
);
const DEV_RECOVERY_REDIRECT_PORT = 3000;

function getDatabaseNameFromUri(uri) {
  if (!uri) return null;

  const [prefix] = uri.split('?');
  const schemeIndex = prefix.indexOf('://');
  const lastSlashIndex = prefix.lastIndexOf('/');

  if (lastSlashIndex === -1 || lastSlashIndex <= schemeIndex + 2) {
    return null;
  }

  const name = prefix.slice(lastSlashIndex + 1);

  return name || null;
}

function hasMongoQueryParam(uri, key) {
  if (!uri || !key) return false;
  const queryIndex = uri.indexOf('?');
  if (queryIndex === -1) return false;
  const params = new URLSearchParams(uri.slice(queryIndex + 1));
  return params.has(key);
}

function setMongoQueryParam(uri, key, value) {
  if (!uri || !key) return uri;
  const [prefix, query = ''] = uri.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  const nextQuery = params.toString();
  return nextQuery ? `${prefix}?${nextQuery}` : prefix;
}

function buildProductionConnectionAttempts(uri) {
  const baseOptions = {
    dbName: ATLAS_DB_NAME,
    serverSelectionTimeoutMS: 10000
  };
  const attempts = [{
    uri,
    options: { ...baseOptions },
    description: 'raw Atlas URI with explicit dbName'
  }];

  if (!hasMongoQueryParam(uri, 'authSource')) {
    attempts.push({
      uri: setMongoQueryParam(uri, 'authSource', 'admin'),
      options: { ...baseOptions },
      description: 'raw Atlas URI with explicit dbName and authSource=admin'
    });
  }

  return attempts;
}



console.log('Startup secrets check:', {
  GOOGLE_CLIENT_ID: !!GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: !!GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: !!GOOGLE_REDIRECT_URI,
  JWT_SECRET: !!JWT_SECRET,
  MONGODB_ATLAS_CONNECTION_STRING: !!MONGODB_ATLAS_URI
});

if (isProduction) {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  if (!JWT_SECRET) missing.push('JWT_SECRET');
  if (!MONGODB_ATLAS_URI) missing.push('MONGODB_ATLAS_CONNECTION_STRING');
  if (missing.length > 0) {
    throw new Error(`❌ Required secrets are missing in production: ${missing.join(', ')}`);
  }
}

const app = express();
const PROD_FAVICON_PATH = path.join(PUBLIC_DIR, 'assets', 'images', 'cloakHood.jpg');
const DEV_FAVICON_PATH = path.join(PUBLIC_DIR, 'assets', 'images', 'cloakHoodInverted.jpg');
const INDEX_HTML_PATH = path.join(PUBLIC_DIR, 'index.html');
const ADMIN_HTML_PATH = path.join(PUBLIC_DIR, 'admin.html');
const ML_ADMIN_HTML_PATH = path.join(PUBLIC_DIR, 'ml-admin.html');
const htmlTemplateCache = new Map();
const staticOptions = {
  etag: true,
  index: false,
  maxAge: isProduction ? '1d' : 0,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath || '').toLowerCase();
    if (!isProduction) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (ext === '.html' || ext === '.js' || ext === '.css') {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=86400');
  },
};

function parseHostname(hostHeader) {
  const raw = typeof hostHeader === 'string' ? hostHeader.trim().toLowerCase() : '';
  const first = raw.split(',')[0] ? raw.split(',')[0].trim() : '';
  if (!first) return '';
  if (first.startsWith('[')) {
    const closing = first.indexOf(']');
    if (closing > 1) return first.slice(1, closing);
    return first;
  }
  const colonIndex = first.indexOf(':');
  return colonIndex >= 0 ? first.slice(0, colonIndex) : first;
}

function resolveFaviconPathForHost(hostHeader) {
  const hostname = parseHostname(hostHeader);
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return DEV_FAVICON_PATH;
  }
  return PROD_FAVICON_PATH;
}

function resolveExistingFaviconPath(hostHeader) {
  const preferredPath = resolveFaviconPathForHost(hostHeader);
  if (fs.existsSync(preferredPath)) {
    return preferredPath;
  }
  if (preferredPath !== DEV_FAVICON_PATH && fs.existsSync(DEV_FAVICON_PATH)) {
    return DEV_FAVICON_PATH;
  }
  if (preferredPath !== PROD_FAVICON_PATH && fs.existsSync(PROD_FAVICON_PATH)) {
    return PROD_FAVICON_PATH;
  }
  return null;
}

function getHtmlTemplate(filePath) {
  if (!htmlTemplateCache.has(filePath)) {
    htmlTemplateCache.set(filePath, fs.readFileSync(filePath, 'utf8'));
  }
  return htmlTemplateCache.get(filePath);
}

function sendVersionedHtml(res, filePath) {
  try {
    const template = getHtmlTemplate(filePath);
    const html = template.replaceAll(ASSET_VERSION_TOKEN, APP_ASSET_VERSION);
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('html').send(html);
  } catch (err) {
    console.error(`Failed to render HTML template "${filePath}":`, err);
    return res.status(500).json({ message: 'Failed to render page.' });
  }
}

// Ensure Express respects proxy headers so OAuth redirect URIs keep https
// when running behind load balancers or reverse proxies.
app.set('trust proxy', true);

const routes = require('./routes');
const initSocket = require('./socket');
const lobbyStore = require('./state/lobby');
const getServerConfig = require('./utils/getServerConfig');
const { startInternalBots } = require('./services/bots/internalBots');
const { startGuestCleanupTask } = require('./services/guestCleanup');
const { isMlWorkflowEnabled } = require('./utils/mlFeatureGate');
const { ensureAdminRequest } = require('./utils/adminAccess');
const { getMlRuntime } = require('./services/ml/runtime');

const mlWorkflowEnabled = isMlWorkflowEnabled();

function isBlockedMlRequestPath(requestPath = '') {
  const normalized = typeof requestPath === 'string' ? requestPath.trim() : '';
  return normalized === '/ml-admin'
    || normalized === '/ml-admin/'
    || normalized === '/ml-admin.html'
    || normalized === '/ml-admin.js'
    || normalized.startsWith('/api/v1/ml');
}

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(helmet());
app.use(compression());
app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (mlWorkflowEnabled || !isBlockedMlRequestPath(req.path)) {
    return next();
  }
  return res.status(404).json({ message: 'Not found' });
});
app.get('/favicon.ico', (req, res) => {
  const hostHeader = req.get('x-forwarded-host') || req.get('host');
  const faviconPath = resolveExistingFaviconPath(hostHeader);
  if (!faviconPath) {
    return res.status(204).end();
  }
  return res.sendFile(faviconPath, (err) => {
    if (!err || res.headersSent) {
      return;
    }
    console.error('Failed to serve favicon:', err);
    res.status(err.statusCode || 500).end();
  });
});
app.get(['/', '/index.html'], (req, res) => {
  sendVersionedHtml(res, INDEX_HTML_PATH);
});
app.get(['/admin', '/admin.html'], async (req, res) => {
  const adminSession = await ensureAdminRequest(req, res);
  if (!adminSession) {
    return;
  }
  sendVersionedHtml(res, ADMIN_HTML_PATH);
});
app.get(['/ml-admin', '/ml-admin.html'], async (req, res) => {
  if (!mlWorkflowEnabled) {
    return res.status(404).json({ message: 'Not found' });
  }
  const adminSession = await ensureAdminRequest(req, res);
  if (!adminSession) {
    return;
  }
  return sendVersionedHtml(res, ML_ADMIN_HTML_PATH);
});
app.use(express.static(PUBLIC_DIR, staticOptions));
// Serve UI image assets from fallback locations if not present in public/
app.use('/assets/images/UI', express.static(path.join(PUBLIC_DIR, 'assets', 'images', 'UI'), staticOptions));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'test-client', 'assets', 'images', 'UI'), staticOptions));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'frontend', 'public', 'assets', 'images', 'UI'), staticOptions));
// Serve Piece image assets from fallback locations if not present in public/
app.use('/assets/images/Pieces', express.static(path.join(PUBLIC_DIR, 'assets', 'images', 'Pieces'), staticOptions));
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'test-client', 'assets', 'images', 'Pieces'), staticOptions));
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'frontend', 'public', 'assets', 'images', 'Pieces'), staticOptions));

async function connectToDatabase() {
  const defaultDevUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit';
  const uri = isProduction ? MONGODB_ATLAS_URI : defaultDevUri;
  const databaseName = isProduction ? ATLAS_DB_NAME : getDatabaseNameFromUri(uri) || 'unknown';

  try {
    console.log(`Connecting to MongoDB database "${databaseName}" (${isProduction ? 'Atlas' : 'local instance'})`);
    if (isProduction) {
      const attempts = buildProductionConnectionAttempts(uri);
      let lastError = null;

      for (let i = 0; i < attempts.length; i += 1) {
        const attempt = attempts[i];
        try {
          if (i > 0) {
            console.warn(`Retrying MongoDB Atlas connection using ${attempt.description}`);
          }
          await mongoose.connect(attempt.uri, attempt.options);
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          await mongoose.disconnect().catch(() => {});
        }
      }

      if (lastError) {
        throw lastError;
      }
    } else {
      await mongoose.connect(uri, {});
    }

    if (isProduction) {
      console.log(`✅ Connected to MongoDB Atlas (${databaseName})`);
    } else {
      console.log(`Connected to MongoDB (localhost) — database "${databaseName}"`);
    }

    return true;
  } catch (err) {
    if (isProduction) {
      console.error(`❌ Failed to connect to MongoDB Atlas (${databaseName}):`, err);
      process.exit(1);
    }

    console.error(`MongoDB (localhost) connection error for database "${databaseName}":`, err);
    return false;
  }
}

function logDevelopmentMongoHelp(uri) {
  const targetUri = uri || process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit';
  console.warn('[startup] MongoDB is unavailable. The server will run in degraded mode until MongoDB is started.');
  console.warn(`[startup] Expected development MongoDB URI: ${targetUri}`);
  console.warn('[startup] Start a local MongoDB server, then restart the API server.');
  console.warn('[startup] Example (cmd.exe): mkdir C:\\data\\db && "C:\\Program Files\\MongoDB\\Server\\8.0\\bin\\mongod.exe" --dbpath C:\\data\\db');
}

async function resetLobbyQueues() {
  try {
    lobbyStore.clear();
    lobbyStore.emitQueueChanged([]);
    console.log('Cleared lobby state from previous server run');
  } catch (err) {
    console.error('Error clearing in-memory lobby state:', err);
  }
}

app.use('/api', routes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = Number(process.env.PORT || DEFAULT_DEV_PORT);
const HAS_EXPLICIT_PORT = typeof process.env.PORT === 'string' && process.env.PORT.trim().length > 0;
const server = http.createServer(app);
let recoveryRedirectServer = null;

initSocket(server);
let shutdownPromise = null;

function buildLocalRedirectTarget(req, targetPort) {
  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').trim();
  const sanitizedHost = forwardedHost.replace(/\s+/g, '');
  const hostname = sanitizedHost.replace(/:\d+$/, '') || 'localhost';
  const protocol = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  const requestPath = req.url || '/';
  return `${protocol}://${hostname}:${targetPort}${requestPath}`;
}

async function maybeStartRecoveryRedirectServer(targetPort) {
  const normalizedTargetPort = Number(targetPort);
  if (
    isProduction
    || HAS_EXPLICIT_PORT
    || !Number.isFinite(normalizedTargetPort)
    || normalizedTargetPort === DEV_RECOVERY_REDIRECT_PORT
  ) {
    return null;
  }

  const redirectServer = http.createServer((req, res) => {
    const location = buildLocalRedirectTarget(req, normalizedTargetPort);
    res.statusCode = 307;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Location', location);
    res.end(`Temporary Redirect: ${location}`);
  });

  try {
    await bindServerPort(redirectServer, {
      preferredPort: DEV_RECOVERY_REDIRECT_PORT,
      allowFallback: false,
    });
    console.warn(`[startup] Recovery redirect listening on ${DEV_RECOVERY_REDIRECT_PORT} and forwarding to ${normalizedTargetPort}.`);
    recoveryRedirectServer = redirectServer;
    return redirectServer;
  } catch (err) {
    if (err?.code === 'EADDRINUSE') {
      redirectServer.close(() => {});
      console.warn(`[startup] Recovery redirect skipped because port ${DEV_RECOVERY_REDIRECT_PORT} is already in use.`);
      return null;
    }
    redirectServer.close(() => {});
    throw err;
  }
}

async function shutdownServer(signal = 'shutdown') {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  shutdownPromise = (async () => {
    console.log(`Received ${signal}; flushing ML runtime state before exit...`);
    server.close((err) => {
      if (err) {
        console.error('Error while closing HTTP server during shutdown:', err);
      }
    });
    if (recoveryRedirectServer) {
      recoveryRedirectServer.close((err) => {
        if (err) {
          console.error('Error while closing recovery redirect server during shutdown:', err);
        }
      });
      recoveryRedirectServer = null;
    }
    try {
      await getMlRuntime().flushForShutdown();
      console.log('ML runtime flushed successfully.');
    } catch (err) {
      console.error('Failed to flush ML runtime during shutdown:', err);
    }
    try {
      await mongoose.disconnect();
    } catch (err) {
      console.error('Failed to disconnect MongoDB during shutdown:', err);
    }
    process.exit(0);
  })();
  return shutdownPromise;
}

['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((signal) => {
  process.on(signal, () => {
    shutdownServer(signal).catch((err) => {
      console.error(`Fatal shutdown error after ${signal}:`, err);
      process.exit(1);
    });
  });
});

async function startServer() {
  const defaultDevUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit';
  const connected = await connectToDatabase();

  if (connected) {
    try {
      await getServerConfig.initServerConfig();
      console.log('Loaded server configuration into memory');
    } catch (err) {
      console.error('Failed to load server configuration:', err);
      if (isProduction) {
        process.exit(1);
      }
    }

    await resetLobbyQueues();
    startGuestCleanupTask();
  }
  if (!connected && !isProduction) {
    logDevelopmentMongoHelp(defaultDevUri);
  }

  const listenResult = await bindServerPort(server, {
    preferredPort: PORT,
    allowFallback: !isProduction && !HAS_EXPLICIT_PORT,
    maxAdditionalPorts: DEFAULT_DEV_PORT_SEARCH_LIMIT,
  });
  const activePort = Number(listenResult?.port || PORT);
  if (listenResult?.usedFallback) {
    console.warn(`[startup] Port ${PORT} is in use; listening on ${activePort} instead.`);
  }
  await maybeStartRecoveryRedirectServer(activePort);
  console.log(`Server is running on port ${activePort}`);
  if (connected) {
    startInternalBots({ port: activePort });
  } else {
    console.warn('[bot-runtime] skipping internal bot startup because MongoDB is not connected');
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  if (isProduction) {
    process.exit(1);
  }
});
