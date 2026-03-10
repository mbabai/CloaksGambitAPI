const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const path = require('path');

const { NODE_ENV, isProduction } = require('./config/loadEnv');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const ATLAS_DB_NAME = 'cloaksgambit';
const MONGODB_ATLAS_URI = process.env.MONGODB_ATLAS_CONNECTION_STRING;

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
const PROD_FAVICON_PATH = path.join(__dirname, '..', 'public', 'assets', 'images', 'cloakHood.jpg');
const DEV_FAVICON_PATH = path.join(__dirname, '..', 'public', 'assets', 'images', 'cloakHoodInverted.jpg');
const staticOptions = {
  etag: true,
  maxAge: isProduction ? '1d' : 0,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath || '').toLowerCase();
    if (!isProduction) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (ext === '.html') {
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
  res.type('image/jpeg');
  const hostHeader = req.get('x-forwarded-host') || req.get('host');
  res.sendFile(resolveFaviconPathForHost(hostHeader));
});
app.use(express.static(path.join(__dirname, '..', 'public'), staticOptions));
// Serve UI image assets from fallback locations if not present in public/
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'public', 'assets', 'images', 'UI'), staticOptions));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'test-client', 'assets', 'images', 'UI'), staticOptions));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'frontend', 'public', 'assets', 'images', 'UI'), staticOptions));
// Serve Piece image assets from fallback locations if not present in public/
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'public', 'assets', 'images', 'Pieces'), staticOptions));
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

async function resetLobbyQueues() {
  try {
    lobbyStore.clear();
    lobbyStore.emitQueueChanged([]);
    console.log('Cleared lobby state from previous server run');
  } catch (err) {
    console.error('Error clearing in-memory lobby state:', err);
  }
}

// Routes
// Serve the PlayArea page at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Serve admin dashboard as a standalone endpoint
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Serve ML admin dashboard
app.get('/ml-admin', (req, res) => {
  if (!mlWorkflowEnabled) {
    return res.status(404).json({ message: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'ml-admin.html'));
});

app.use('/api', routes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

initSocket(server);

async function startServer() {
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

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    startInternalBots({ port: PORT });
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  if (isProduction) {
    process.exit(1);
  }
});
