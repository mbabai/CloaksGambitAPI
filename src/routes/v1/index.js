const express = require('express');
const router = express.Router();

// User routes
const userGetList = require('./users/getList');
const userGetDetails = require('./users/getDetails');
const userCreate = require('./users/create');
const userUpdate = require('./users/update');
const userPurge = require('./users/purge');

// Config routes
const configTimeSettings = require('./config/getTimeSettings');

// Match routes
const matchGetList = require('./matches/getList');
const matchGetDetails = require('./matches/getDetails');
const matchCreate = require('./matches/create');
const matchDelete = require('./matches/delete');
const matchPurge = require('./matches/purge');
const matchPurgeActive = require('./matches/purgeActive');

// Game routes
const gameGetList = require('./games/getList');
const gameGetDetails = require('./games/getDetails');
const gameCreate = require('./games/create');
const gamePurge = require('./games/purge');

// Game action routes
const gameActionCheckTimeControl = require('./gameAction/checkTimeControl');
const gameActionSetup = require('./gameAction/setup');
const gameActionMove = require('./gameAction/move');
const gameActionChallenge = require('./gameAction/challenge');
const gameActionBomb = require('./gameAction/bomb');
const gameActionOnDeck = require('./gameAction/onDeck');
const gameActionPass = require('./gameAction/pass');
const gameActionResign = require('./gameAction/resign');
const gameActionDraw = require('./gameAction/draw');
const gameActionReady = require('./gameAction/ready');
const gameActionNext = require('./gameAction/next');

// Lobby routes
const lobbyGet = require('./lobby/get');
const lobbyEnterQuickplay = require('./lobby/enterQuickplay');
const lobbyExitQuickplay = require('./lobby/exitQuickplay');
const lobbyEnterRanked = require('./lobby/enterRanked');
const lobbyExitRanked = require('./lobby/exitRanked');
const { router: lobbyMatchmaking } = require('./lobby/matchmaking');

// User routes
router.use('/users/getList', userGetList);
router.use('/users/getDetails', userGetDetails);
router.use('/users/create', userCreate);
router.use('/users/update', userUpdate);
router.use('/users/purge', userPurge);

// Config routes
router.use('/config/timeSettings', configTimeSettings);

// Match routes
router.use('/matches/getList', matchGetList);
router.use('/matches/getDetails', matchGetDetails);
router.use('/matches/create', matchCreate);
router.use('/matches/delete', matchDelete);
router.use('/matches/purge', matchPurge);
router.use('/matches/purge-active', matchPurgeActive);

// Game routes
router.use('/games/getList', gameGetList);
router.use('/games/getDetails', gameGetDetails);
router.use('/games/create', gameCreate);
router.use('/games/purge', gamePurge);

// Game action routes
router.use('/gameAction/checkTimeControl', gameActionCheckTimeControl);
router.use('/gameAction/setup', gameActionSetup);
router.use('/gameAction/move', gameActionMove);
router.use('/gameAction/challenge', gameActionChallenge);
router.use('/gameAction/bomb', gameActionBomb);
router.use('/gameAction/onDeck', gameActionOnDeck);
router.use('/gameAction/pass', gameActionPass);
router.use('/gameAction/resign', gameActionResign);
router.use('/gameAction/draw', gameActionDraw);
router.use('/gameAction/ready', gameActionReady);
router.use('/gameAction/next', gameActionNext);

// Lobby routes
router.use('/lobby/get', lobbyGet);
router.use('/lobby/enterQuickplay', lobbyEnterQuickplay);
router.use('/lobby/exitQuickplay', lobbyExitQuickplay);
router.use('/lobby/enterRanked', lobbyEnterRanked);
router.use('/lobby/exitRanked', lobbyExitRanked);
router.use('/lobby/matchmaking', lobbyMatchmaking);

module.exports = router;
