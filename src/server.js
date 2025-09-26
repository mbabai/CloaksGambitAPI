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

function getEnvValue(...keys) {
  for (const key of keys) {
    if (!key) continue;
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function getGoogleClientId() {
  return getEnvValue(
    'GOOGLE_CLIENT_ID',
    'GoogleAuth-ClientID',
    'GoogleAuth_ClientID',
    'GoogleAuthClientID'
  );
}

function getGoogleClientSecret() {
  return getEnvValue(
    'GOOGLE_CLIENT_SECRET',
    'GoogleAuth-ClientSecret',
    'GoogleAuth_ClientSecret',
    'GoogleAuthClientSecret'
  );
}

const COSMOS_DB_NAME = 'myDatabase';
const COSMOS_COLLECTION_NAME = 'myCollection';
const COSMOS_URI = process.env.COSMOSDB_CONNECTION_STRING;
const GOOGLE_CLIENT_ID = getGoogleClientId();
const GOOGLE_CLIENT_SECRET = getGoogleClientSecret();

if (isProduction) {
  const missingSecrets = [];
  if (!COSMOS_URI) missingSecrets.push('COSMOSDB_CONNECTION_STRING');
  if (!GOOGLE_CLIENT_ID) missingSecrets.push('GOOGLE_CLIENT_ID (or GoogleAuth-ClientID)');
  if (!GOOGLE_CLIENT_SECRET) missingSecrets.push('GOOGLE_CLIENT_SECRET (or GoogleAuth-ClientSecret)');

  if (missingSecrets.length > 0) {
    console.error(
      `❌ Missing required secrets in production: ${missingSecrets.join(', ')}. Check Key Vault references.`
    );
    process.exit(1);
  }
}

const app = express();

const routes = require('./routes');
const initSocket = require('./socket');
const Lobby = require('./models/Lobby');

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
  const uri = isProduction ? COSMOS_URI : defaultDevUri;

  const connectionOptions = isProduction
    ? {
        dbName: COSMOS_DB_NAME,
        serverSelectionTimeoutMS: 10000
      }
    : {};

  try {
    await mongoose.connect(uri, connectionOptions);

    if (isProduction) {
      console.log('✅ Connected to Cosmos DB (Mongo API)');

      try {
        const cosmosCollection = mongoose.connection.db.collection(COSMOS_COLLECTION_NAME);
        await cosmosCollection.findOne({}, { projection: { _id: 1 } });
        console.log(`✅ Verified Cosmos DB collection \`${COSMOS_COLLECTION_NAME}\``);
      } catch (collectionErr) {
        console.error(
          `❌ Unable to access required collection \`${COSMOS_COLLECTION_NAME}\` in Cosmos DB:`,
          collectionErr
        );
        process.exit(1);
      }
    } else {
      console.log('Connected to MongoDB');
    }

    return true;
  } catch (err) {
    if (isProduction) {
      console.error('❌ Failed to connect to Cosmos DB:', err);
      process.exit(1);
    }

    console.error('MongoDB connection error:', err);
    return false;
  }
}

async function resetLobbyQueues() {
  try {
    const lobby = await Lobby.findOne();
    if (lobby) {
      lobby.quickplayQueue = [];
      lobby.rankedQueue = [];
      lobby.inGame = [];
      await lobby.save();
      console.log('Cleared stale queues from previous server run');
    } else {
      // Create a new lobby if none exists
      await Lobby.create({
        quickplayQueue: [],
        rankedQueue: [],
        inGame: []
      });
      console.log('Created new lobby');
    }
  } catch (err) {
    console.error('Error clearing queues:', err);
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
    await resetLobbyQueues();
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
