const { normalizeId } = require('../src/services/matches/activeMatches');
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
});
