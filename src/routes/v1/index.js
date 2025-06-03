const express = require('express');
const router = express.Router();

// User routes
const userGetList = require('./users/getList');
const userGetDetails = require('./users/getDetails');
const userCreate = require('./users/create');

// Match routes
const matchGetList = require('./matches/getList');
const matchGetDetails = require('./matches/getDetails');
const matchCreate = require('./matches/create');

// Game routes
const gameGetList = require('./games/getList');
const gameGetDetails = require('./games/getDetails');
const gameCreate = require('./games/create');

// Game action routes
const gameActionCheckTimeControl = require('./gameAction/checkTimeControl');
const gameActionSetup = require('./gameAction/setup');
const gameActionMove = require('./gameAction/move');
const gameActionChallenge = require('./gameAction/challenge');
const gameActionBomb = require('./gameAction/bomb');
const gameActionOnDeck = require('./gameAction/onDeck');
const gameActionPass = require('./gameAction/pass');
const gameActionResign = require('./gameAction/resign');
const gameActionReady = require('./gameAction/ready');

// Lobby routes
const lobbyGet = require('./lobby/get');
const lobbyEnterQuickplay = require('./lobby/enterQuickplay');
const lobbyExitQuickplay = require('./lobby/exitQuickplay');
const lobbyEnterRanked = require('./lobby/enterRanked');
const lobbyExitRanked = require('./lobby/exitRanked');

// User routes
router.use('/users/getList', userGetList);
router.use('/users/getDetails', userGetDetails);
router.use('/users/create', userCreate);

// Match routes
router.use('/matches/getList', matchGetList);
router.use('/matches/getDetails', matchGetDetails);
router.use('/matches/create', matchCreate);

// Game routes
router.use('/games/getList', gameGetList);
router.use('/games/getDetails', gameGetDetails);
router.use('/games/create', gameCreate);

// Game action routes
router.use('/gameAction/checkTimeControl', gameActionCheckTimeControl);
router.use('/gameAction/setup', gameActionSetup);
router.use('/gameAction/move', gameActionMove);
router.use('/gameAction/challenge', gameActionChallenge);
router.use('/gameAction/bomb', gameActionBomb);
router.use('/gameAction/onDeck', gameActionOnDeck);
router.use('/gameAction/pass', gameActionPass);
router.use('/gameAction/resign', gameActionResign);
router.use('/gameAction/ready', gameActionReady);

// Lobby routes
router.use('/lobby/get', lobbyGet);
router.use('/lobby/enterQuickplay', lobbyEnterQuickplay);
router.use('/lobby/exitQuickplay', lobbyExitQuickplay);
router.use('/lobby/enterRanked', lobbyEnterRanked);
router.use('/lobby/exitRanked', lobbyExitRanked);

module.exports = router; 