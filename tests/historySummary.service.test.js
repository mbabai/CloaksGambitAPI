const { getMatchResult } = require('../src/services/history/summary');

describe('history summary match result helper', () => {
  it('prefers the match winner id over contradictory score values', () => {
    const result = getMatchResult({
      _id: 'match-1',
      player1: { _id: 'user-1', username: 'Murelious' },
      player2: { _id: 'user-2', username: 'MediumBot' },
      winner: { id: 'user-1', username: 'Murelious' },
      player1Score: 0,
      player2Score: 1,
      type: 'AI',
    }, 'user-1');

    expect(result.winnerId).toBe('user-1');
    expect(result.player1Result).toBe('win');
    expect(result.player2Result).toBe('loss');
    expect(result.userResult).toBe('win');
  });

  it('falls back to score totals when no winner id is available', () => {
    const result = getMatchResult({
      _id: 'match-2',
      player1: { _id: 'user-1' },
      player2: { _id: 'user-2' },
      winner: null,
      player1Score: 2,
      player2Score: 1,
      type: 'QUICKPLAY',
    }, 'user-2');

    expect(result.winnerId).toBeNull();
    expect(result.player1Result).toBe('win');
    expect(result.player2Result).toBe('loss');
    expect(result.userResult).toBe('loss');
  });
});
