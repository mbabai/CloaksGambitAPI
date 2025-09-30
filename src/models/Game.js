const mongoose = require('mongoose');
const ServerConfig = require('./ServerConfig');
const {
  generateId,
  toIdString,
  cloneValue,
  matchesQuery,
  applyUpdate,
  QueryBase,
  applySelect,
} = require('./inMemoryUtils');

const defaultConfig = new ServerConfig();

async function getRuntimeConfig() {
  try {
    return await ServerConfig.getSingleton();
  } catch (err) {
    console.error('Failed to fetch server config for validation, falling back to defaults:', err);
    return null;
  }
}

const pieceSchema = new mongoose.Schema({
  color: {
    type: Number,
    enum: Array.from(defaultConfig.colors.values()),
    required: true,
  },
  identity: {
    type: Number,
    enum: Array.from(defaultConfig.identities.values()),
    required: true,
  },
}, { _id: false });

const actionSchema = new mongoose.Schema({
  type: {
    type: Number,
    enum: Array.from(defaultConfig.actions.values()),
    required: true,
  },
  player: {
    type: Number,
    enum: [0, 1],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {},
  },
}, { _id: false });

const drawOfferSchema = new mongoose.Schema({
  player: {
    type: Number,
    enum: [0, 1],
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const moveSchema = new mongoose.Schema({
  player: {
    type: Number,
    enum: [0, 1],
    required: true,
  },
  from: {
    row: { type: Number, required: true },
    col: { type: Number, required: true },
  },
  to: {
    row: { type: Number, required: true },
    col: { type: Number, required: true },
  },
  declaration: {
    type: Number,
    enum: Array.from(defaultConfig.identities.values()),
    required: true,
  },
  state: {
    type: Number,
    enum: Array.from(defaultConfig.moveStates.values()),
    default: defaultConfig.moveStates.get('PENDING'),
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const gameSchema = new mongoose.Schema({
  players: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    validate: {
      validator: function validator(value) {
        return value.length === 2 && value[0] !== value[1];
      },
      message: 'Game must have exactly two different players',
    },
    required: true,
  },
  match: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Match',
    required: true,
  },
  playersReady: {
    type: [Boolean],
    default: [false, false],
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'Players ready must contain exactly two boolean values',
    },
  },
  playersNext: {
    type: [Boolean],
    default: [false, false],
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'Players next must contain exactly two boolean values',
    },
  },
  playerTurn: {
    type: Number,
    default: null,
    validate: {
      validator: function validator(value) {
        return value === null || value === 0 || value === 1;
      },
      message: 'Player turn must be null, 0 (white), or 1 (black)',
    },
  },
  winner: {
    type: Number,
    enum: [0, 1],
    validate: {
      validator: function validator(value) {
        return !this.isActive || value === 0 || value === 1;
      },
      message: 'Winner must be 0 (white) or 1 (black) when game is ended',
    },
  },
  winReason: {
    type: Number,
    enum: Array.from(defaultConfig.winReasons.values()),
    validate: {
      validator: function validator(value) {
        return !this.isActive || value !== undefined;
      },
      message: 'Win reason must be specified when game is ended',
    },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  startTime: {
    type: Date,
  },
  endTime: {
    type: Date,
    validate: {
      validator: function validator(value) {
        if (!value) return true;
        return value > this.startTime;
      },
      message: 'End time must be after start time',
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  timeControlStart: {
    type: Number,
    required: true,
    validate: {
      validator: async function validator(value) {
        const runtimeConfig = await getRuntimeConfig();
        const rankedTime = runtimeConfig?.gameModeSettings?.RANKED?.TIME_CONTROL
          ?? defaultConfig.gameModeSettings.RANKED.TIME_CONTROL;
        const quickplayTime = runtimeConfig?.gameModeSettings?.QUICKPLAY?.TIME_CONTROL
          ?? defaultConfig.gameModeSettings.QUICKPLAY.TIME_CONTROL;
        return value === rankedTime || value === quickplayTime;
      },
      message: 'Time control must match either RANKED or QUICKPLAY settings from server config',
    },
  },
  increment: {
    type: Number,
    required: true,
    validate: {
      validator: async function validator(value) {
        const runtimeConfig = await getRuntimeConfig();
        const increment = runtimeConfig?.gameModeSettings?.INCREMENT
          ?? defaultConfig.gameModeSettings.INCREMENT;
        return value === increment;
      },
      message: 'Increment must match the server config INCREMENT value',
    },
  },
  board: {
    type: [[pieceSchema]],
    default() {
      return Array(defaultConfig.boardDimensions.RANKS)
        .fill(null)
        .map(() => Array(defaultConfig.boardDimensions.FILES).fill(null));
    },
    validate: {
      validator: function validator(value) {
        return value.length === defaultConfig.boardDimensions.RANKS
          && value.every((row) => row.length === defaultConfig.boardDimensions.FILES);
      },
      message: 'Board dimensions must match server configuration',
    },
  },
  stashes: {
    type: [[pieceSchema]],
    default() {
      const createStash = (color) => [
        { color, identity: defaultConfig.identities.get('ROOK') },
        { color, identity: defaultConfig.identities.get('ROOK') },
        { color, identity: defaultConfig.identities.get('BISHOP') },
        { color, identity: defaultConfig.identities.get('BISHOP') },
        { color, identity: defaultConfig.identities.get('KNIGHT') },
        { color, identity: defaultConfig.identities.get('KNIGHT') },
        { color, identity: defaultConfig.identities.get('KING') },
        { color, identity: defaultConfig.identities.get('BOMB') },
      ];

      return [
        createStash(defaultConfig.colors.get('WHITE')),
        createStash(defaultConfig.colors.get('BLACK')),
      ];
    },
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'Stashes must contain exactly two arrays (white and black)',
    },
  },
  onDecks: {
    type: [mongoose.Schema.Types.Mixed],
    default: [null, null],
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'On deck pieces must contain exactly two slots (white and black)',
    },
  },
  captured: {
    type: [[pieceSchema]],
    default: [[], []],
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'Captured pieces must contain exactly two arrays (white and black)',
    },
  },
  actions: {
    type: [actionSchema],
    default: [],
  },
  moves: {
    type: [moveSchema],
    default: [],
  },
  daggers: {
    type: [Number],
    default: [0, 0],
    validate: {
      validator: function validator(value) {
        return value.length === 2 && value.every((count) => count >= 0);
      },
      message: 'Daggers must contain exactly two non-negative numbers',
    },
  },
  movesSinceAction: {
    type: Number,
    default: 0,
    min: 0,
  },
  setupComplete: {
    type: [Boolean],
    default: [false, false],
    validate: {
      validator: function validator(value) {
        return value.length === 2;
      },
      message: 'Setup complete must contain exactly two boolean values',
    },
  },
  onDeckingPlayer: {
    type: Number,
    default: null,
    validate: {
      validator: function validator(value) {
        return value === null || value === 0 || value === 1;
      },
      message: 'onDeckingPlayer must be null, 0, or 1',
    },
  },
  drawOffer: {
    type: drawOfferSchema,
    default: null,
  },
  drawOfferCooldowns: {
    type: [Date],
    default: [null, null],
    validate: {
      validator: function validator(value) {
        return Array.isArray(value) && value.length === 2;
      },
      message: 'Draw offer cooldowns must contain exactly two entries',
    },
  },
});

async function updateMatchAfterGame(game, createNextGame) {
  try {
    const Match = require('./Match');
    const match = await Match.findById(game.match);
    if (!match) return;

    if (!match.isActive) {
      return;
    }

    if (game.winner === 0 || game.winner === 1) {
      const winnerId = game.players?.[game.winner];
      if (winnerId) {
        const winnerStr = toIdString(winnerId);
        if (winnerStr === toIdString(match.player1)) {
          match.player1Score = (match.player1Score || 0) + 1;
        } else if (winnerStr === toIdString(match.player2)) {
          match.player2Score = (match.player2Score || 0) + 1;
        }
      }
    } else if (game.winner === null) {
      match.drawCount = (match.drawCount || 0) + 1;
    }

    const config = new ServerConfig();
    const typeSettings = config.gameModeSettings[match.type]
      || config.gameModeSettings.get?.(match.type);
    const winScore = typeSettings?.WIN_SCORE;
    const drawWins = Number.isFinite(winScore) && (match.drawCount || 0) >= winScore;

    if (drawWins) {
      await match.endMatch(null);
      return;
    }

    if (
      Number.isFinite(winScore)
      && ((match.player1Score || 0) >= winScore || (match.player2Score || 0) >= winScore)
    ) {
      const winnerId = (match.player1Score || 0) >= winScore ? match.player1 : match.player2;
      await match.endMatch(winnerId);
      return;
    }

    if (typeof createNextGame === 'function') {
      const nextGame = await createNextGame();
      if (nextGame) {
        if (Array.isArray(match.games)) {
          match.games.push(nextGame._id);
        } else {
          match.games = [nextGame._id];
        }
        await match.save();
      }
    }
  } catch (err) {
    console.error('Failed to update match after game end:', err);
  }
}

gameSchema.methods.endGame = async function endGame(winner, winReason) {
  if (!this.isActive) {
    throw new Error('Game is already ended');
  }

  if (winner !== null && winner !== 0 && winner !== 1) {
    throw new Error('Winner must be 0 (white), 1 (black) or null for draw');
  }

  const validWinReasons = Array.from(defaultConfig.winReasons.values());
  if (!validWinReasons.includes(winReason)) {
    throw new Error('Invalid win reason');
  }

  this.winner = winner;
  this.winReason = winReason;
  this.endTime = new Date();
  this.isActive = false;
  this.drawOffer = null;
  this.drawOfferCooldowns = [null, null];
  this.markModified('drawOffer');
  this.markModified('drawOfferCooldowns');
  await this.save();

  await updateMatchAfterGame(this, async () => {
    const GameModel = require('./Game');
    return GameModel.create({
      players: [this.players[1], this.players[0]],
      match: this.match,
      timeControlStart: this.timeControlStart,
      increment: this.increment,
    });
  });

  return this;
};

gameSchema.methods.makeMove = function makeMove(from, to, declaration) {
  if (!this.isActive) {
    throw new Error('Game is not active');
  }

  const move = {
    from,
    to,
    declaration,
    state: defaultConfig.moveStates.get('PENDING'),
    timestamp: new Date(),
  };

  this.moves.push(move);
  return this.save();
};

gameSchema.methods.addAction = function addAction(type, player, details) {
  if (!this.isActive) {
    throw new Error('Game is not active');
  }

  if (typeof type !== 'number' || type < 0 || type > 7) {
    throw new Error('Invalid action type');
  }

  const actionDetails = details || {};

  const action = {
    type,
    player,
    details: actionDetails,
    timestamp: new Date(),
  };

  this.actions.push(action);
  return this;
};

const GameHistoryModel = mongoose.models.Game || mongoose.model('Game', gameSchema);

function toObjectId(value) {
  if (!value) return undefined;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return undefined;
}

function sanitizeForPersistence(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForPersistence(item))
      .filter((item) => item !== undefined);
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      result[key] = sanitizeForPersistence(val);
    }
    return result;
  }
  return value;
}

function isHistoryQuery(query = {}) {
  if (!query || typeof query !== 'object') return false;
  if ('isActive' in query) {
    const val = query.isActive;
    if (val === false) return true;
    if (val && typeof val === 'object') {
      if (Array.isArray(val.$in) && val.$in.includes(false) && !val.$in.includes(true)) {
        return true;
      }
    }
  }
  return false;
}

function ensureTwo(value, fallback) {
  if (!Array.isArray(value) || value.length !== 2) {
    return cloneValue(fallback);
  }
  return value.slice(0, 2);
}

function createDefaultBoard() {
  const ranks = defaultConfig.boardDimensions.RANKS;
  const files = defaultConfig.boardDimensions.FILES;
  return Array.from({ length: ranks }, () => Array.from({ length: files }, () => null));
}

function createDefaultStashes() {
  const white = defaultConfig.colors.get('WHITE');
  const black = defaultConfig.colors.get('BLACK');
  const template = (color) => ([
    { color, identity: defaultConfig.identities.get('ROOK') },
    { color, identity: defaultConfig.identities.get('ROOK') },
    { color, identity: defaultConfig.identities.get('BISHOP') },
    { color, identity: defaultConfig.identities.get('BISHOP') },
    { color, identity: defaultConfig.identities.get('KNIGHT') },
    { color, identity: defaultConfig.identities.get('KNIGHT') },
    { color, identity: defaultConfig.identities.get('KING') },
    { color, identity: defaultConfig.identities.get('BOMB') },
  ]);

  return [template(white), template(black)];
}

function createDefaultDaggers() {
  return [0, 0];
}

function cloneDate(value) {
  return value ? new Date(value) : value;
}

class GameDocument {
  constructor(data = {}) {
    this._id = toIdString(data._id) || generateId();
    this.players = Array.isArray(data.players) ? data.players.map(toIdString) : [];
    this.match = data.match ? toIdString(data.match) : null;
    this.playersReady = ensureTwo(data.playersReady, [false, false]);
    this.playersNext = ensureTwo(data.playersNext, [false, false]);
    this.playerTurn = data.playerTurn ?? null;
    this.winner = data.winner ?? undefined;
    this.winReason = data.winReason ?? undefined;
    this.createdAt = cloneDate(data.createdAt) || new Date();
    this.startTime = cloneDate(data.startTime) || null;
    this.endTime = cloneDate(data.endTime) || null;
    this.isActive = data.isActive !== undefined ? Boolean(data.isActive) : true;
    this.timeControlStart = data.timeControlStart ?? defaultConfig.gameModeSettings.QUICKPLAY.TIME_CONTROL;
    this.increment = data.increment ?? defaultConfig.gameModeSettings.INCREMENT;
    this.board = Array.isArray(data.board) ? cloneValue(data.board) : createDefaultBoard();
    this.stashes = Array.isArray(data.stashes) ? cloneValue(data.stashes) : createDefaultStashes();
    this.onDecks = ensureTwo(data.onDecks, [null, null]);
    this.captured = Array.isArray(data.captured) ? cloneValue(data.captured) : [[], []];
    this.actions = Array.isArray(data.actions) ? cloneValue(data.actions) : [];
    this.moves = Array.isArray(data.moves) ? cloneValue(data.moves) : [];
    this.daggers = Array.isArray(data.daggers) ? data.daggers.slice(0, 2) : createDefaultDaggers();
    this.movesSinceAction = data.movesSinceAction ?? 0;
    this.setupComplete = ensureTwo(data.setupComplete, [false, false]);
    this.onDeckingPlayer = data.onDeckingPlayer ?? null;
    this.drawOffer = data.drawOffer ? cloneValue(data.drawOffer) : null;
    this.drawOfferCooldowns = ensureTwo(data.drawOfferCooldowns, [null, null]);
  }

  markModified() {
    // No-op for in-memory compatibility with Mongoose API
  }

  async save() {
    GameModel._store.set(this._id, this);
    return this;
  }

  toObject() {
    return GameModel._toObject(this);
  }

  toJSON() {
    return this.toObject();
  }

  async endGame(winner, winReason) {
    if (!this.isActive) {
      throw new Error('Game is already ended');
    }

    if (winner !== null && winner !== 0 && winner !== 1) {
      throw new Error('Winner must be 0 (white), 1 (black) or null for draw');
    }

    const validWinReasons = Array.from(defaultConfig.winReasons.values());
    if (!validWinReasons.includes(winReason)) {
      throw new Error('Invalid win reason');
    }

    this.winner = winner;
    this.winReason = winReason;
    this.endTime = new Date();
    this.isActive = false;
    this.drawOffer = null;
    this.drawOfferCooldowns = [null, null];

    await this.save();
    await GameModel._persistDocument(this);
    await updateMatchAfterGame(this, async () => GameModel.create({
      players: [this.players[1], this.players[0]],
      match: this.match,
      timeControlStart: this.timeControlStart,
      increment: this.increment,
    }));

    return this;
  }

  makeMove(from, to, declaration) {
    if (!this.isActive) {
      throw new Error('Game is not active');
    }

    const move = {
      from,
      to,
      declaration,
      state: defaultConfig.moveStates.get('PENDING'),
      timestamp: new Date(),
    };

    this.moves.push(move);
    return this.save();
  }

  addAction(type, player, details) {
    if (!this.isActive) {
      throw new Error('Game is not active');
    }

    if (typeof type !== 'number' || type < 0 || type > 7) {
      throw new Error('Invalid action type');
    }

    const action = {
      type,
      player,
      details: details || {},
      timestamp: new Date(),
    };

    this.actions.push(action);
    GameModel._store.set(this._id, this);
    return this;
  }

  validateSync(pathsToValidate) {
    const prepared = GameModel._prepareForMongo(this);
    const { _id, ...payload } = prepared;
    const tempDoc = new GameHistoryModel(payload);
    tempDoc._id = toObjectId(this._id) || this._id || tempDoc._id;
    return tempDoc.validateSync(pathsToValidate);
  }

  async validate(pathsToValidate) {
    const prepared = GameModel._prepareForMongo(this);
    const { _id, ...payload } = prepared;
    const tempDoc = new GameHistoryModel(payload);
    tempDoc._id = toObjectId(this._id) || this._id || tempDoc._id;
    await tempDoc.validate(pathsToValidate);
    return this;
  }
}

class GameModel {
  static _store = new Map();

  static _prepareForMongo(doc) {
    const plain = this._toObject(doc) || {};

    const prepared = {
      ...plain,
      players: Array.isArray(plain.players)
        ? plain.players.map((id) => toObjectId(id)).filter(Boolean)
        : [],
      match: toObjectId(plain.match),
    };

    if (!prepared.match) {
      delete prepared.match;
    }

    return sanitizeForPersistence(prepared);
  }

  static async _persistDocument(doc) {
    const key = toIdString(doc?._id);
    if (!key) return;

    const objectId = toObjectId(key);
    if (!objectId) {
      console.error('Failed to persist completed game - invalid ObjectId:', key);
      return;
    }

    const prepared = this._prepareForMongo({ ...doc, isActive: false });
    const { _id, ...rest } = prepared;

    try {
      await GameHistoryModel.updateOne(
        { _id: objectId },
        { $set: rest },
        { upsert: true, setDefaultsOnInsert: true },
      );
      this._store.delete(key);
    } catch (err) {
      console.error('Failed to persist completed game to MongoDB:', err);
    }
  }

  static _ensureDocument(doc) {
    if (!doc) return null;
    if (doc instanceof GameDocument) return doc;
    return new GameDocument(doc);
  }

  static _toObject(doc) {
    if (!doc) return null;
    if (typeof doc.toObject === 'function') {
      const obj = doc.toObject === GameDocument.prototype.toObject
        ? null
        : doc.toObject();
      if (obj) return obj;
    }
    const plain = {};
    Object.entries(doc).forEach(([key, value]) => {
      if (typeof value === 'function') return;
      plain[key] = cloneValue(value);
    });
    if (!plain._id && doc._id) {
      plain._id = cloneValue(doc._id);
    }
    return plain;
  }

  static _selectOnDocument(doc, selectSet) {
    const plain = this._toObject(doc);
    if (!plain) return plain;
    if (!selectSet || selectSet.size === 0) {
      return plain;
    }
    return applySelect(plain, selectSet);
  }

  static async _populateDocument(doc, path, options = {}) {
    if (!doc) return doc;
    if (path === 'match') {
      const Match = require('./Match');
      const populated = options.lean
        ? await Match.findById(doc.match).lean()
        : await Match.findById(doc.match);
      if (!populated) return doc;
      const clone = Object.assign(
        Object.create(Object.getPrototypeOf(doc) || {}),
        doc,
      );
      clone.match = populated;
      return clone;
    }
    return doc;
  }

  static async create(data) {
    const doc = this._ensureDocument(data);
    await doc.save();
    return doc;
  }

  static find(query = {}) {
    if (isHistoryQuery(query)) {
      return GameHistoryModel.find(query);
    }
    const results = Array.from(this._store.values()).filter((doc) => matchesQuery(doc, query));
    return new QueryBase(this, results, { multi: true });
  }

  static findById(id) {
    const key = toIdString(id);
    if (key && this._store.has(key)) {
      return new QueryBase(this, this._store.get(key));
    }
    return GameHistoryModel.findById(id);
  }

  static findOne(query = {}) {
    if (isHistoryQuery(query)) {
      return GameHistoryModel.findOne(query);
    }
    const results = Array.from(this._store.values()).filter((doc) => matchesQuery(doc, query));
    return new QueryBase(this, results, { fromList: true });
  }

  static async exists(query = {}) {
    if (isHistoryQuery(query)) {
      const existing = await GameHistoryModel.exists(query);
      return Boolean(existing);
    }
    return Array.from(this._store.values()).some((doc) => matchesQuery(doc, query));
  }

  static async deleteMany(query = {}) {
    if (isHistoryQuery(query)) {
      return GameHistoryModel.deleteMany(query);
    }
    const keys = [];
    for (const [key, doc] of this._store.entries()) {
      if (matchesQuery(doc, query)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => this._store.delete(key));
    return { acknowledged: true, deletedCount: keys.length };
  }

  static async updateOne(filter, update) {
    if (isHistoryQuery(filter)) {
      return GameHistoryModel.updateOne(filter, update);
    }
    const doc = Array.from(this._store.values()).find((item) => matchesQuery(item, filter));
    if (!doc) {
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    }
    applyUpdate(doc, update);
    await doc.save();
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  }

  static findByIdAndUpdate(id, update, options = {}) {
    const key = toIdString(id);
    if (key && this._store.has(key)) {
      const doc = this._store.get(key);
      applyUpdate(doc, update);
      doc.updatedAt = new Date();
      this._store.set(key, doc);
      return new QueryBase(this, doc);
    }
    return GameHistoryModel.findByIdAndUpdate(id, update, options);
  }

  static _getRawDocument(id) {
    return this._store.get(toIdString(id));
  }
}

GameModel.historyModel = GameHistoryModel;
if (typeof GameHistoryModel.watch === 'function') {
  GameModel.watch = (...args) => GameHistoryModel.watch(...args);
}

module.exports = GameModel;
