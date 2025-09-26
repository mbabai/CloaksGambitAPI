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
const COSMOS_URI = process.env.COSMOSDB_CONNECTION_STRING;
const COSMOS_COLLECTION_NAME = 'myCollection';

const cosmosPreview = COSMOS_URI ? `${COSMOS_URI.slice(0, 60)}${COSMOS_URI.length > 60 ? '…' : ''}` : null;

console.log('Startup secrets check:', {
  GOOGLE_CLIENT_ID: !!GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: !!GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: !!GOOGLE_REDIRECT_URI,
  COSMOSDB_CONNECTION_STRING: !!COSMOS_URI,
  COSMOSDB_CONNECTION_STRING_PREVIEW: cosmosPreview
});

if (isProduction) {
  const missing = [];
  if (!GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!GOOGLE_REDIRECT_URI) missing.push('GOOGLE_REDIRECT_URI');
  if (!COSMOS_URI) missing.push('COSMOSDB_CONNECTION_STRING');
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
        serverSelectionTimeoutMS: 10000,
        useNewUrlParser: true,
        useUnifiedTopology: true
      }
    : {};

  try {
    await mongoose.connect(uri, connectionOptions);

    if (isProduction) {
      console.log('✅ Connected to Cosmos DB');

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
      console.error('❌ Failed to connect:', err);
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
