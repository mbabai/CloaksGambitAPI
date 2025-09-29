const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Load environment variables from a file based on NODE_ENV. Default to
// `.env.development` so local development has Google OAuth credentials
// without needing to manually copy them to `.env`.
if (!isProduction) {
  const envFile = `.env.${NODE_ENV}`;
  require('dotenv').config({ path: path.resolve(__dirname, '..', envFile) });
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const ATLAS_DB_NAME = 'cloaksgambit';
const MONGODB_ATLAS_URI_RAW = process.env.MONGODB_ATLAS_CONNECTION_STRING;

function ensureDatabaseInUri(uri, dbName) {
  if (!uri) return uri;

  const [prefix, params] = uri.split('?');
  const match = prefix.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)(?:\/(.*))?$/i);

  let base = prefix;

  if (match) {
    base = match[1];
  } else if (prefix.endsWith('/')) {
    base = prefix.replace(/\/+$/, '');
  } else {
    const lastSlashIndex = prefix.lastIndexOf('/');
    base = lastSlashIndex === -1 ? prefix : prefix.slice(0, lastSlashIndex);
  }

  const finalPrefix = `${base}/${dbName}`;

  return params ? `${finalPrefix}?${params}` : finalPrefix;
}

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

const MONGODB_ATLAS_URI = ensureDatabaseInUri(MONGODB_ATLAS_URI_RAW, ATLAS_DB_NAME);

const atlasPreview = MONGODB_ATLAS_URI
  ? `${MONGODB_ATLAS_URI.slice(0, 60)}${MONGODB_ATLAS_URI.length > 60 ? '…' : ''}`
  : null;

console.log('Startup secrets check:', {
  GOOGLE_CLIENT_ID: !!GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: !!GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: !!GOOGLE_REDIRECT_URI,
  MONGODB_ATLAS_CONNECTION_STRING: !!MONGODB_ATLAS_URI,
  MONGODB_ATLAS_CONNECTION_STRING_PREVIEW: atlasPreview
});

if (isProduction) {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  if (!MONGODB_ATLAS_URI) missing.push('MONGODB_ATLAS_CONNECTION_STRING');
  if (missing.length > 0) {
    throw new Error(`❌ Required secrets are missing in production: ${missing.join(', ')}`);
  }
}

const app = express();

// Ensure Express respects proxy headers so OAuth redirect URIs keep https
// when running behind load balancers or reverse proxies.
app.set('trust proxy', true);

const routes = require('./routes');
const initSocket = require('./socket');
const { lobbies, rankedQueue, quickplayQueue, matches, games } = require('./state');

// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// Serve UI image assets from fallback locations if not present in public/
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'public', 'assets', 'images', 'UI')));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'test-client', 'assets', 'images', 'UI')));
app.use('/assets/images/UI', express.static(path.join(__dirname, '..', 'frontend', 'public', 'assets', 'images', 'UI')));
// Serve Piece image assets from fallback locations if not present in public/
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'public', 'assets', 'images', 'Pieces')));
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'test-client', 'assets', 'images', 'Pieces')));
app.use('/assets/images/Pieces', express.static(path.join(__dirname, '..', 'frontend', 'public', 'assets', 'images', 'Pieces')));

async function connectToDatabase() {
  const defaultDevUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit';
  const uri = isProduction ? MONGODB_ATLAS_URI : defaultDevUri;
  const databaseName = isProduction ? ATLAS_DB_NAME : getDatabaseNameFromUri(uri) || 'unknown';

  const connectionOptions = isProduction
    ? {
        serverSelectionTimeoutMS: 10000,
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    : {};

  try {
    console.log(`Connecting to MongoDB database "${databaseName}" (${isProduction ? 'Atlas' : 'local instance'})`);
    await mongoose.connect(uri, connectionOptions);

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

function resetLobbyQueues() {
  rankedQueue.splice(0, rankedQueue.length);
  quickplayQueue.splice(0, quickplayQueue.length);
  matches.clear();
  games.clear();

  const defaultLobby = lobbies.default || {};
  defaultLobby.quickplayQueue = quickplayQueue;
  defaultLobby.rankedQueue = rankedQueue;
  defaultLobby.inGame = [];
  lobbies.default = defaultLobby;

  console.log('Initialized in-memory lobby state');
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
    resetLobbyQueues();
  }

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  if (isProduction) {
    process.exit(1);
  }
});
