const API = window.location.origin;
const logEl = document.getElementById('log');
function log(msg) {
  console.log(msg);
  logEl.textContent += `\n${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

const players = [];
let gameId = null;

async function createUser(idx) {
  const res = await fetch(`${API}/api/v1/users/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `test${idx}`, email: `test${idx}@example.com` })
  });
  const data = await res.json();
  log(`Created user${idx}: ${data._id}`);
  return data;
}

async function connect() {
  for (let i = 0; i < 2; i++) {
    const user = await createUser(i + 1);
    const socket = io('/', { auth: { userId: user._id } });
    socket.on('connect', () => log(`Player${i + 1} socket connected`));
    socket.on('match:found', (m) => {
      log(`Player${i + 1} matched: game ${m.gameId}`);
      gameId = m.gameId;
    });
    socket.on('game:update', (u) => log(`game:update ${JSON.stringify(u)}`));
    players.push({ id: user._id, socket });
  }
  document.getElementById('queue').disabled = false;
}

document.getElementById('connect').onclick = connect;

document.getElementById('queue').onclick = async () => {
  for (const p of players) {
    const res = await fetch(`${API}/api/v1/lobby/enterQuickplay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: p.id })
    });
    const data = await res.json();
    log(`Queue response for ${p.id}: ${JSON.stringify(data)}`);
    if (data.gameId) gameId = data.gameId;
  }
  document.getElementById('setup').disabled = false;
};

function piece(color, identity, row, col) {
  return { color, identity, row, col };
}

async function setupAndReady() {
  const whitePieces = [
    piece(0, 4, 0, 0),
    piece(0, 3, 0, 1),
    piece(0, 1, 0, 2),
    piece(0, 5, 0, 3),
    piece(0, 4, 0, 4)
  ];
  const blackPieces = [
    piece(1, 4, 5, 0),
    piece(1, 3, 5, 1),
    piece(1, 1, 5, 2),
    piece(1, 5, 5, 3),
    piece(1, 4, 5, 4)
  ];

  await fetch(`${API}/api/v1/gameAction/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0, pieces: whitePieces, onDeck: { color: 0, identity: 3 } })
  });
  await fetch(`${API}/api/v1/gameAction/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 1, pieces: blackPieces, onDeck: { color: 1, identity: 3 } })
  });

  await fetch(`${API}/api/v1/gameAction/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0 })
  });
  await fetch(`${API}/api/v1/gameAction/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 1 })
  });

  log('Setup complete and players ready');
  document.getElementById('play').disabled = false;
}

document.getElementById('setup').onclick = setupAndReady;

async function playSequence() {
  log('White moves rook');
  await fetch(`${API}/api/v1/gameAction/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0, from: { row: 0, col: 0 }, to: { row: 2, col: 0 }, declaration: 4 })
  });

  log('Black challenges');
  await fetch(`${API}/api/v1/gameAction/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 1 })
  });

  log('White selects on-deck knight');
  await fetch(`${API}/api/v1/gameAction/onDeck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0, piece: { identity: 5 } })
  });

  log('Black moves rook onto white piece');
  await fetch(`${API}/api/v1/gameAction/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 1, from: { row: 5, col: 0 }, to: { row: 2, col: 0 }, declaration: 4 })
  });

  log('White bombs');
  await fetch(`${API}/api/v1/gameAction/bomb`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0 })
  });

  log('Black passes');
  await fetch(`${API}/api/v1/gameAction/pass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 1 })
  });

  log('White resigns');
  await fetch(`${API}/api/v1/gameAction/resign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color: 0 })
  });
}

document.getElementById('play').onclick = playSequence;
