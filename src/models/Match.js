const mongoose = require('mongoose');
const ServerConfig = require('./ServerConfig');
const eventBus = require('../eventBus');
const User = require('./User');
const lobbyStore = require('../state/lobby');
const {
  generateId,
  toIdString,
  cloneValue,
  matchesQuery,
  applyUpdate,
  QueryBase,
  applySelect,
} = require('./inMemoryUtils');

const DEFAULT_ELO = 800;
const defaultConfig = new ServerConfig();

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

const matchSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Array.from(defaultConfig.gameModes.values()),
    required: true,
    set(value) {
      return value?.toUpperCase();
    },
  },
  player1: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  player2: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    validate: {
      validator(value) {
        return value.toString() !== this.player1.toString();
      },
      message: 'Player 2 must be different from Player 1',
    },
  },
  player1Score: {
    type: Number,
    default: 0,
  },
  player2Score: {
    type: Number,
    default: 0,
  },
  drawCount: {
    type: Number,
    default: 0,
  },
  player1StartElo: {
    type: Number,
    required() {
      return this.type === defaultConfig.gameModes.get('RANKED');
    },
  },
  player2StartElo: {
    type: Number,
    required() {
      return this.type === defaultConfig.gameModes.get('RANKED');
    },
  },
  player1EndElo: {
    type: Number,
    required() {
      return this.type === defaultConfig.gameModes.get('RANKED');
    },
  },
  player2EndElo: {
    type: Number,
    required() {
      return this.type === defaultConfig.gameModes.get('RANKED');
    },
  },
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    validate: {
      validator(value) {
        if (!value) return true;
        return value.toString() === this.player1.toString()
          || value.toString() === this.player2.toString();
      },
      message: 'Winner must be either Player 1 or Player 2',
    },
  },
  games: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Game',
    default: [],
  },
  startTime: {
    type: Date,
    default: Date.now,
  },
  endTime: {
    type: Date,
    validate: {
      validator(value) {
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
});

matchSchema.virtual('duration').get(function duration() {
  if (!this.endTime) return null;
  return this.endTime - this.startTime;
});

matchSchema.methods.endMatch = async function endMatch(winnerId = null) {
  if (!this.isActive) {
    throw new Error('Match is already ended');
  }

  const normalizedWinnerId = winnerId ?? null;
  const hasWinner = Boolean(normalizedWinnerId);

  if (hasWinner) {
    const winnerStr = normalizedWinnerId.toString();
    if (winnerStr !== this.player1.toString() && winnerStr !== this.player2.toString()) {
      throw new Error('Winner must be either Player 1 or Player 2');
    }
  }

  this.winner = normalizedWinnerId;
  this.endTime = new Date();
  this.isActive = false;

  const rankedMode = defaultConfig.gameModes.get('RANKED');
  if (this.type === rankedMode) {
    let player1Start = Number.isFinite(this.player1StartElo) ? this.player1StartElo : null;
    let player2Start = Number.isFinite(this.player2StartElo) ? this.player2StartElo : null;

    const [player1User, player2User] = await Promise.all([
      User.findById(this.player1).catch(() => null),
      User.findById(this.player2).catch(() => null),
    ]);

    if (!Number.isFinite(player1Start)) {
      player1Start = Number.isFinite(player1User?.elo) ? player1User.elo : DEFAULT_ELO;
      this.player1StartElo = player1Start;
    }

    if (!Number.isFinite(player2Start)) {
      player2Start = Number.isFinite(player2User?.elo) ? player2User.elo : DEFAULT_ELO;
      this.player2StartElo = player2Start;
    }

    const winnerStr = hasWinner ? normalizedWinnerId.toString() : null;
    let player1Score = 0.5;
    if (winnerStr) {
      if (winnerStr === this.player1.toString()) {
        player1Score = 1;
      } else if (winnerStr === this.player2.toString()) {
        player1Score = 0;
      }
    }
    const player2Score = 1 - player1Score;

    const expected1 = 1 / (1 + Math.pow(10, (player2Start - player1Start) / 400));
    const K_FACTOR = 32;
    const delta1 = Math.round(K_FACTOR * (player1Score - expected1));
    const delta2 = -delta1;
    const player1End = Math.max(0, Math.round(player1Start + delta1));
    const player2End = Math.max(0, Math.round(player2Start + delta2));

    this.player1EndElo = player1End;
    this.player2EndElo = player2End;

    const updates = [];
    if (player1User) {
      player1User.elo = player1End;
      updates.push(player1User.save().catch((err) => {
        console.error('Failed to update player1 elo', err);
      }));
    } else {
      updates.push(User.updateOne({ _id: this.player1 }, { $set: { elo: player1End } }).catch((err) => {
        console.error('Failed to upsert player1 elo', err);
      }));
    }

    if (player2User) {
      player2User.elo = player2End;
      updates.push(player2User.save().catch((err) => {
        console.error('Failed to update player2 elo', err);
      }));
    } else {
      updates.push(User.updateOne({ _id: this.player2 }, { $set: { elo: player2End } }).catch((err) => {
        console.error('Failed to upsert player2 elo', err);
      }));
    }

    await Promise.all(updates);
  }

  const saved = await this.save();

  try {
    eventBus.emit('match:ended', {
      matchId: this._id.toString(),
      winner: this.winner ? this.winner.toString() : null,
      players: [this.player1?.toString(), this.player2?.toString()].filter(Boolean),
    });
  } catch (err) {
    console.error('Error emitting match:ended event:', err);
  }

  try {
    const players = [this.player1?.toString(), this.player2?.toString()].filter(Boolean);
    if (players.length > 0) {
      const { removed } = lobbyStore.removeInGame(players);
      if (removed) {
        lobbyStore.emitQueueChanged(players);
      }
    }
  } catch (err) {
    console.error('Error removing players from lobby.inGame after match end:', err);
  }

  return saved;
};

matchSchema.pre('save', function ensureEndTime(next) {
  if (!this.isActive && !this.endTime) {
    this.endTime = new Date();
  }
  next();
});

const MatchHistoryModel = mongoose.models.Match || mongoose.model('Match', matchSchema);

function cloneDate(value) {
  return value ? new Date(value) : value;
}

class MatchDocument {
  constructor(data = {}) {
    this._id = toIdString(data._id) || generateId();
    this.type = (data.type || defaultConfig.gameModes.get('QUICKPLAY') || 'QUICKPLAY').toUpperCase();
    this.player1 = data.player1 ? toIdString(data.player1) : null;
    this.player2 = data.player2 ? toIdString(data.player2) : null;
    this.player1Score = data.player1Score ?? 0;
    this.player2Score = data.player2Score ?? 0;
    this.drawCount = data.drawCount ?? 0;
    this.player1StartElo = data.player1StartElo ?? null;
    this.player2StartElo = data.player2StartElo ?? null;
    this.player1EndElo = data.player1EndElo ?? null;
    this.player2EndElo = data.player2EndElo ?? null;
    this.winner = data.winner ? toIdString(data.winner) : null;
    this.games = Array.isArray(data.games) ? data.games.map(toIdString) : [];
    this.startTime = cloneDate(data.startTime) || new Date();
    this.endTime = cloneDate(data.endTime) || null;
    this.isActive = data.isActive !== undefined ? Boolean(data.isActive) : true;
    this.createdAt = cloneDate(data.createdAt) || new Date();
  }

  get duration() {
    if (!this.endTime) return null;
    return this.endTime - this.startTime;
  }

  async save() {
    MatchModel._store.set(this._id, this);
    return this;
  }

  toObject() {
    return MatchModel._toObject(this);
  }

  toJSON() {
    return this.toObject();
  }

  async endMatch(winnerId = null) {
    if (!this.isActive) {
      throw new Error('Match is already ended');
    }

    const normalizedWinnerId = winnerId ? toIdString(winnerId) : null;
    const hasWinner = Boolean(normalizedWinnerId);

    if (hasWinner) {
      const winnerStr = normalizedWinnerId;
      if (winnerStr !== toIdString(this.player1) && winnerStr !== toIdString(this.player2)) {
        throw new Error('Winner must be either Player 1 or Player 2');
      }
    }

    this.winner = normalizedWinnerId;
    this.endTime = new Date();
    this.isActive = false;

    const rankedMode = defaultConfig.gameModes.get('RANKED');
    if (this.type === rankedMode) {
      let player1Start = Number.isFinite(this.player1StartElo) ? this.player1StartElo : null;
      let player2Start = Number.isFinite(this.player2StartElo) ? this.player2StartElo : null;

      const [player1User, player2User] = await Promise.all([
        User.findById(this.player1).catch(() => null),
        User.findById(this.player2).catch(() => null),
      ]);

      if (!Number.isFinite(player1Start)) {
        player1Start = Number.isFinite(player1User?.elo) ? player1User.elo : DEFAULT_ELO;
        this.player1StartElo = player1Start;
      }

      if (!Number.isFinite(player2Start)) {
        player2Start = Number.isFinite(player2User?.elo) ? player2User.elo : DEFAULT_ELO;
        this.player2StartElo = player2Start;
      }

      const winnerStr = hasWinner ? normalizedWinnerId : null;
      let player1Score = 0.5;
      if (winnerStr) {
        if (winnerStr === toIdString(this.player1)) {
          player1Score = 1;
        } else if (winnerStr === toIdString(this.player2)) {
          player1Score = 0;
        }
      }
      const player2Score = 1 - player1Score;

      const expected1 = 1 / (1 + Math.pow(10, (player2Start - player1Start) / 400));
      const K_FACTOR = 32;
      const delta1 = Math.round(K_FACTOR * (player1Score - expected1));
      const delta2 = -delta1;
      const player1End = Math.max(0, Math.round(player1Start + delta1));
      const player2End = Math.max(0, Math.round(player2Start + delta2));

      this.player1EndElo = player1End;
      this.player2EndElo = player2End;

      const updates = [];
      if (player1User) {
        player1User.elo = player1End;
        updates.push(player1User.save().catch((err) => {
          console.error('Failed to update player1 elo', err);
        }));
      } else {
        updates.push(User.updateOne({ _id: this.player1 }, { $set: { elo: player1End } }).catch((err) => {
          console.error('Failed to upsert player1 elo', err);
        }));
      }

      if (player2User) {
        player2User.elo = player2End;
        updates.push(player2User.save().catch((err) => {
          console.error('Failed to update player2 elo', err);
        }));
      } else {
        updates.push(User.updateOne({ _id: this.player2 }, { $set: { elo: player2End } }).catch((err) => {
          console.error('Failed to upsert player2 elo', err);
        }));
      }

      await Promise.all(updates);
    }

    await this.save();

    try {
      eventBus.emit('match:ended', {
        matchId: this._id.toString(),
        winner: this.winner ? this.winner.toString() : null,
        players: [this.player1, this.player2].filter(Boolean).map((id) => id.toString()),
      });
    } catch (err) {
      console.error('Error emitting match:ended event:', err);
    }

    try {
      const players = [this.player1, this.player2].filter(Boolean).map((id) => id.toString());
      if (players.length > 0) {
        const { removed } = lobbyStore.removeInGame(players);
        if (removed) {
          lobbyStore.emitQueueChanged(players);
        }
      }
    } catch (err) {
      console.error('Error removing players from lobby.inGame after match end:', err);
    }

    await MatchModel._persistDocument(this);

    return this;
  }
}

class MatchModel {
  static _store = new Map();

  static _prepareForMongo(doc) {
    const plain = this._toObject(doc) || {};

    const prepared = {
      ...plain,
      player1: toObjectId(plain.player1),
      player2: toObjectId(plain.player2),
      winner: plain.winner ? toObjectId(plain.winner) : null,
      games: Array.isArray(plain.games)
        ? plain.games.map((id) => toObjectId(id)).filter(Boolean)
        : [],
      isActive: false,
    };

    if (!prepared.player1) delete prepared.player1;
    if (!prepared.player2) delete prepared.player2;
    if (prepared.winner === undefined) delete prepared.winner;

    return sanitizeForPersistence(prepared);
  }

  static async _persistDocument(doc) {
    const key = toIdString(doc?._id);
    if (!key) return;

    const objectId = toObjectId(key);
    if (!objectId) {
      console.error('Failed to persist completed match - invalid ObjectId:', key);
      return;
    }

    const prepared = this._prepareForMongo(doc);
    const { _id, ...rest } = prepared;

    try {
      await MatchHistoryModel.updateOne(
        { _id: objectId },
        { $set: rest },
        { upsert: true, setDefaultsOnInsert: true },
      );
      this._store.delete(key);
    } catch (err) {
      console.error('Failed to persist completed match to MongoDB:', err);
    }
  }

  static _ensureDocument(doc) {
    if (!doc) return null;
    if (doc instanceof MatchDocument) return doc;
    return new MatchDocument(doc);
  }

  static _toObject(doc) {
    if (!doc) return null;
    if (typeof doc.toObject === 'function' && doc.toObject !== MatchDocument.prototype.toObject) {
      return doc.toObject();
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
    if (path === 'games') {
      const Game = require('./Game');
      const source = Array.isArray(doc.games) ? doc.games : [];
      const populated = [];
      for (const gameId of source) {
        if (options.lean) {
          const leanGame = await Game.findById(gameId).lean();
          if (leanGame) populated.push(leanGame);
        } else {
          const gameDoc = await Game.findById(gameId);
          if (gameDoc) populated.push(gameDoc);
        }
      }
      const clone = Object.assign(
        Object.create(Object.getPrototypeOf(doc) || {}),
        doc,
      );
      clone.games = populated;
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
      return MatchHistoryModel.find(query);
    }
    const results = Array.from(this._store.values()).filter((doc) => matchesQuery(doc, query));
    return new QueryBase(this, results, { multi: true });
  }

  static findById(id) {
    const key = toIdString(id);
    if (key && this._store.has(key)) {
      return new QueryBase(this, this._store.get(key));
    }
    return MatchHistoryModel.findById(id);
  }

  static findOne(query = {}) {
    if (isHistoryQuery(query)) {
      return MatchHistoryModel.findOne(query);
    }
    const results = Array.from(this._store.values()).filter((doc) => matchesQuery(doc, query));
    return new QueryBase(this, results, { fromList: true });
  }

  static async exists(query = {}) {
    if (isHistoryQuery(query)) {
      const existing = await MatchHistoryModel.exists(query);
      return Boolean(existing);
    }
    return Array.from(this._store.values()).some((doc) => matchesQuery(doc, query));
  }

  static async deleteMany(query = {}) {
    if (isHistoryQuery(query)) {
      return MatchHistoryModel.deleteMany(query);
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
      return MatchHistoryModel.updateOne(filter, update);
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
    return MatchHistoryModel.findByIdAndUpdate(id, update, options);
  }
}

MatchModel.historyModel = MatchHistoryModel;
if (typeof MatchHistoryModel.watch === 'function') {
  MatchModel.watch = (...args) => MatchHistoryModel.watch(...args);
}

module.exports = MatchModel;
