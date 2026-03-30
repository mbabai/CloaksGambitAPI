const { toOptionalFiniteNumber } = require('./standings');

function makeMatchId(prefix = 'brkt') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildSeedOrder(size) {
  const normalizedSize = Number(size);
  if (!Number.isInteger(normalizedSize) || normalizedSize < 2) {
    return [];
  }

  let order = [1, 2];
  while (order.length < normalizedSize) {
    const nextSize = order.length * 2;
    const nextOrder = [];
    order.forEach((seed) => {
      nextOrder.push(seed);
      nextOrder.push((nextSize + 1) - seed);
    });
    order = nextOrder;
  }
  return order;
}

function getRoundLabel(roundIndex, roundCount) {
  const totalRounds = Number(roundCount);
  const index = Number(roundIndex);
  if (!Number.isInteger(totalRounds) || !Number.isInteger(index)) {
    return 'Elimination';
  }
  if (totalRounds === 1) return 'Final';
  if (index === totalRounds - 1) return 'Final';
  if (index === totalRounds - 2) return 'Semifinals';
  if (index === totalRounds - 3) return 'Quarterfinals';
  return `Round ${index + 1}`;
}

function cloneEntrant(entrant) {
  if (!entrant) return null;
  return {
    entryId: entrant.entryId || null,
    userId: entrant.userId || null,
    username: entrant.username || 'Player',
    seed: toOptionalFiniteNumber(entrant.seed),
    type: entrant.type || 'human',
    difficulty: entrant.difficulty || null,
  };
}

function makeSource(section, roundIndex, matchIndex, outcome) {
  return {
    section,
    roundIndex,
    matchIndex,
    outcome,
  };
}

function createMatch({
  prefix,
  section,
  roundIndex,
  matchIndex,
  label,
  playerA = null,
  playerB = null,
  sourceA = null,
  sourceB = null,
  finalStage = null,
} = {}) {
  return {
    id: makeMatchId(prefix),
    section,
    roundIndex,
    matchIndex,
    label,
    status: 'waiting',
    playerA: cloneEntrant(playerA),
    playerB: cloneEntrant(playerB),
    sourceA: sourceA || null,
    sourceB: sourceB || null,
    winner: null,
    matchId: null,
    gameId: null,
    finalStage: finalStage || null,
  };
}

function normalizeEntrants(entrants = []) {
  return Array.isArray(entrants)
    ? entrants
        .map((entrant) => cloneEntrant(entrant))
        .filter((entrant) => entrant && entrant.userId)
    : [];
}

function getBracketSize(entrantCount) {
  let bracketSize = 1;
  while (bracketSize < entrantCount) {
    bracketSize *= 2;
  }
  return bracketSize;
}

function buildInitialSeedMap(entrants, bracketSize) {
  const seedMap = new Map();
  entrants.forEach((entrant) => {
    const seed = toOptionalFiniteNumber(entrant.seed);
    if (seed === null) return;
    seedMap.set(seed, entrant);
  });
  const seedOrder = buildSeedOrder(bracketSize);
  return { seedMap, seedOrder };
}

function buildWinnersRounds(entrants, bracketSize) {
  const { seedMap, seedOrder } = buildInitialSeedMap(entrants, bracketSize);
  const roundCount = Math.log2(bracketSize);
  const winnersRounds = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const matchCount = bracketSize / Math.pow(2, roundIndex + 1);
    const matches = [];
    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      const match = createMatch({
        prefix: 'wbr',
        section: 'winners',
        roundIndex,
        matchIndex,
        label: getRoundLabel(roundIndex, roundCount),
      });
      if (roundIndex === 0) {
        const seedA = seedOrder[matchIndex * 2];
        const seedB = seedOrder[(matchIndex * 2) + 1];
        match.playerA = cloneEntrant(seedMap.get(seedA));
        match.playerB = cloneEntrant(seedMap.get(seedB));
      } else {
        match.sourceA = makeSource('winnersRounds', roundIndex - 1, matchIndex * 2, 'winner');
        match.sourceB = makeSource('winnersRounds', roundIndex - 1, (matchIndex * 2) + 1, 'winner');
      }
      matches.push(match);
    }
    winnersRounds.push({
      section: 'winners',
      roundIndex,
      label: getRoundLabel(roundIndex, roundCount),
      matches,
    });
  }

  return winnersRounds;
}

function buildSingleEliminationBracket(entrants = []) {
  const normalizedEntrants = normalizeEntrants(entrants);
  if (normalizedEntrants.length < 2) {
    return {
      type: 'single',
      bracketSize: normalizedEntrants.length,
      rounds: [],
      winnersRounds: [],
      losersRounds: [],
      finalsRounds: [],
    };
  }

  const bracketSize = getBracketSize(normalizedEntrants.length);
  const winnersRounds = buildWinnersRounds(normalizedEntrants, bracketSize);

  return {
    type: 'single',
    bracketSize,
    rounds: winnersRounds,
    winnersRounds,
    losersRounds: [],
    finalsRounds: [],
  };
}

function buildDoubleEliminationBracket(entrants = []) {
  const normalizedEntrants = normalizeEntrants(entrants);
  if (normalizedEntrants.length < 2) {
    return {
      type: 'double',
      bracketSize: normalizedEntrants.length,
      rounds: [],
      winnersRounds: [],
      losersRounds: [],
      finalsRounds: [],
    };
  }

  const bracketSize = getBracketSize(normalizedEntrants.length);
  const winnersRounds = buildWinnersRounds(normalizedEntrants, bracketSize);
  const winnersRoundCount = winnersRounds.length;
  const losersRounds = [];

  for (let groupIndex = 1; groupIndex < winnersRoundCount; groupIndex += 1) {
    const matchCount = winnersRounds[groupIndex].matches.length;
    const minorRoundIndex = losersRounds.length;
    const minorMatches = [];
    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      const minorMatch = createMatch({
        prefix: 'lbr',
        section: 'losers',
        roundIndex: minorRoundIndex,
        matchIndex,
        label: `Losers ${minorRoundIndex + 1}`,
      });
      if (groupIndex === 1) {
        minorMatch.sourceA = makeSource('winnersRounds', 0, matchIndex * 2, 'loser');
        minorMatch.sourceB = makeSource('winnersRounds', 0, (matchIndex * 2) + 1, 'loser');
      } else {
        minorMatch.sourceA = makeSource('losersRounds', minorRoundIndex - 1, matchIndex * 2, 'winner');
        minorMatch.sourceB = makeSource('losersRounds', minorRoundIndex - 1, (matchIndex * 2) + 1, 'winner');
      }
      minorMatches.push(minorMatch);
    }
    losersRounds.push({
      section: 'losers',
      roundIndex: minorRoundIndex,
      label: `Losers ${minorRoundIndex + 1}`,
      matches: minorMatches,
    });

    const majorRoundIndex = losersRounds.length;
    const majorMatches = [];
    for (let matchIndex = 0; matchIndex < matchCount; matchIndex += 1) {
      majorMatches.push(createMatch({
        prefix: 'lbr',
        section: 'losers',
        roundIndex: majorRoundIndex,
        matchIndex,
        label: `Losers ${majorRoundIndex + 1}`,
        sourceA: makeSource('losersRounds', minorRoundIndex, matchIndex, 'winner'),
        sourceB: makeSource('winnersRounds', groupIndex, matchIndex, 'loser'),
      }));
    }
    losersRounds.push({
      section: 'losers',
      roundIndex: majorRoundIndex,
      label: `Losers ${majorRoundIndex + 1}`,
      matches: majorMatches,
    });
  }

  const finalsRounds = [];
  finalsRounds.push({
    section: 'finals',
    roundIndex: 0,
    label: 'Grand Final',
    matches: [
      createMatch({
        prefix: 'fin',
        section: 'finals',
        roundIndex: 0,
        matchIndex: 0,
        label: 'Grand Final',
        sourceA: makeSource('winnersRounds', winnersRoundCount - 1, 0, 'winner'),
        sourceB: makeSource('losersRounds', losersRounds.length - 1, 0, 'winner'),
        finalStage: 'grand_final',
      }),
    ],
  });
  finalsRounds.push({
    section: 'finals',
    roundIndex: 1,
    label: 'Reset Final',
    active: false,
    matches: [
      createMatch({
        prefix: 'fin',
        section: 'finals',
        roundIndex: 1,
        matchIndex: 0,
        label: 'Reset Final',
        finalStage: 'reset_final',
      }),
    ],
  });

  return {
    type: 'double',
    bracketSize,
    rounds: winnersRounds,
    winnersRounds,
    losersRounds,
    finalsRounds,
  };
}

module.exports = {
  buildSeedOrder,
  buildSingleEliminationBracket,
  buildDoubleEliminationBracket,
  getRoundLabel,
};
