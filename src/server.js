const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

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

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/cloaks-gambit')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Clear any stale queues from previous server runs
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
  })
  .catch((err) => console.error('MongoDB connection error:', err));

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

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
