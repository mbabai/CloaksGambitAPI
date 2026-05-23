const {
  normalizeId,
  resolvePlayerDisplayName,
} = require('../src/services/matches/activeMatches');
const mongoose = require('mongoose');

describe('activeMatches normalizeId', () => {
  test('normalizes Mongo ObjectIds to their hex string value', () => {
    const objectId = new mongoose.Types.ObjectId('68df60afeaebdf355cd8d015');

    expect(normalizeId(objectId)).toBe('68df60afeaebdf355cd8d015');
  });

  test('handles circular populated objects without overflowing the stack', () => {
    const circular = {};
    circular._id = circular;
    circular.id = 'user-123';

    expect(normalizeId(circular)).toBe('user-123');
  });

  test('returns null for circular objects with no usable id value', () => {
    const circular = {};
    circular._id = circular;

    expect(normalizeId(circular)).toBeNull();
  });

  test('resolves safe fallback names for missing history players', () => {
    expect(resolvePlayerDisplayName({
      user: { username: 'MediumBot', isBot: true },
      match: { type: 'AI' },
      playerIndex: 1,
    })).toBe('MediumBot');

    expect(resolvePlayerDisplayName({
      user: null,
      match: { type: 'AI' },
      playerIndex: 1,
    })).toBe('Cloak Bot');

    expect(resolvePlayerDisplayName({
      user: null,
      match: { type: 'QUICKPLAY' },
      playerIndex: 0,
    })).toBe('Anonymous');
  });

  test('prefers tournament participant bot names over bot instance usernames', () => {
    expect(resolvePlayerDisplayName({
      user: { username: 'mediumbot_a698cd7e', isBot: true },
      match: { type: 'TOURNAMENT_ROUND_ROBIN' },
      playerIndex: 1,
      participant: { type: 'bot', username: 'TESTER', difficulty: 'medium' },
    })).toBe('TESTER (MediumBot)');

    expect(resolvePlayerDisplayName({
      user: { username: 'mediumbot_a698cd7e', isBot: true },
      match: { type: 'TOURNAMENT_ROUND_ROBIN' },
      playerIndex: 1,
    })).toBe('MediumBot');
  });
});
