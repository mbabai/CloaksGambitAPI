const express = require('express');
const router = express.Router();

// User routes
const userGetList = require('./users/getList');
const userGetDetails = require('./users/getDetails');

// Match routes
const matchGetList = require('./matches/getList');
const matchGetDetails = require('./matches/getDetails');

// Game routes
const gameGetList = require('./games/getList');
const gameGetDetails = require('./games/getDetails');

// Game action routes
const gameActionCheckTimeControl = require('./gameAction/checkTimeControl');
const gameActionSetup = require('./gameAction/setup');
const gameActionMove = require('./gameAction/move');
const gameActionChallenge = require('./gameAction/challenge');
const gameActionBomb = require('./gameAction/bomb');
const gameActionOnDeck = require('./gameAction/onDeck');
const gameActionPass = require('./gameAction/pass');
const gameActionResign = require('./gameAction/resign');

// Lobby routes
const lobbyGet = require('./lobby/get');

// User routes
router.use('/users/getList', userGetList);
router.use('/users/getDetails', userGetDetails);

// Match routes
router.use('/matches/getList', matchGetList);
router.use('/matches/getDetails', matchGetDetails);

// Game routes
router.use('/games/getList', gameGetList);
router.use('/games/getDetails', gameGetDetails);

// Game action routes
router.use('/gameAction/checkTimeControl', gameActionCheckTimeControl);
router.use('/gameAction/setup', gameActionSetup);
router.use('/gameAction/move', gameActionMove);
router.use('/gameAction/challenge', gameActionChallenge);
router.use('/gameAction/bomb', gameActionBomb);
router.use('/gameAction/onDeck', gameActionOnDeck);
router.use('/gameAction/pass', gameActionPass);
router.use('/gameAction/resign', gameActionResign);

// Lobby routes
router.use('/lobby/get', lobbyGet);

module.exports = router; 