const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
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
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to Cloaks Gambit API' });
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
