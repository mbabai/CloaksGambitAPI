const API = 'http://localhost:3000';

// Player objects with their own log elements and state
const players = {
  player1: {
    id: null,
    socket: null,
    logEl: document.getElementById('log1'),
    color: null, // Will be determined by the game
    name: 'Player 1',
    isReady: false,
    inQueue: false,
    isMoving: false
  },
  player2: {
    id: null,
    socket: null,
    logEl: document.getElementById('log2'),
    color: null, // Will be determined by the game
    name: 'Player 2',
    isReady: false,
    inQueue: false,
    isMoving: false
  }
};

let gameId = null;
let matchId = null;
let currentTurn = 0;
let gamePhase = 'Not Started';
let actionSequence = [];
let currentActionIndex = 0;

// Logging function for each player
function log(player, msg) {
  console.log(`[${player.name}] ${msg}`);
  const logEl = player.logEl;
  
  // Handle newlines properly in the display
  if (typeof msg === 'string' && msg.includes('\n')) {
    const lines = msg.split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        logEl.textContent += `\n${line}`;
      }
    });
  } else {
    logEl.textContent += `\n${msg}`;
  }
  logEl.scrollTop = logEl.scrollHeight;
}

// Update global game status display
function updateGameStatus() {
  document.getElementById('gameIdDisplay').textContent = gameId || 'None';
  document.getElementById('matchIdDisplay').textContent = matchId || 'None';
  document.getElementById('turnDisplay').textContent = currentTurn === 0 ? 'White' : 'Black';
  document.getElementById('phaseDisplay').textContent = gamePhase;
  
  // Update turn display based on current turn
  if (gamePhase === 'Setup Complete') {
    const currentTurn = currentActionIndex % 2; // 0 = White, 1 = Black
    const currentPlayerName = currentTurn === 0 ? 'White' : 'Black';
    document.getElementById('turnDisplay').textContent = `${currentPlayerName} (Current Turn)`;
  }
}

// Create user for a specific player
async function createUser(player) {
  const timestamp = Date.now();
  const res = await fetch(`${API}/api/v1/users/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      username: `${player.name.toLowerCase()}_${timestamp}`, 
      email: `${player.name.toLowerCase()}_${timestamp}@example.com` 
    })
  });
  const data = await res.json();
  player.id = data._id;
  log(player, `Created user: ${data._id}`);
  return data;
}

// Establish socket connection for a player
async function establishSocketConnection(player) {
  if (player.id) {
    const socket = io('http://localhost:3000', { auth: { userId: player.id } });
    
    socket.on('connect', () => {
      log(player, `Socket connected`);
      player.socket = socket;
    });
    
    socket.on('match:found', (m) => {
      log(player, `Matched: game ${m.gameId}`);
      gameId = m.gameId;
      matchId = m.matchId;
      updateGameStatus();
      
      // Both players are now in a game, so they're not in queue anymore
      players.player1.inQueue = false;
      players.player2.inQueue = false;
      
      log(player, 'Both players removed from queue - game started (socket event)');
      
      // Reset ready state for new game
      resetReadyState();
      
      // Enable ready buttons for both players when game starts
      enableReadyButtonsForGame();
      
      // Both players are no longer in queue, so show "Join Queue" buttons
      updateQueueButton(players.player1, false);
      updateQueueButton(players.player2, false);
    });
    
    socket.on('game:update', (u) => {
  // Debug: Log the raw data structure
  log(player, `\n=== RAW GAME UPDATE DATA ===`);
  log(player, `Stashes: ${JSON.stringify(u.stashes)}`);
  log(player, `OnDecks: ${JSON.stringify(u.onDecks)}`);
  log(player, `Players: ${JSON.stringify(u.players)}`);
  
  // Determine player color from the game data
  if (player.color === null) {
    // Find which player this is based on the game data
    if (u.players && u.players.length === 2) {
      // This is a simplified way to determine color - in a real game you'd get this from the server
      if (player.name === 'Player 1') {
        player.color = 0; // Usually Player 1 is white
      } else {
        player.color = 1; // Usually Player 2 is black
      }
    }
  }
  
  log(player, `\n=== GAME UPDATE ===`);
  log(player, `Match ID: ${u.matchId}`);
  log(player, `Game ID: ${u.gameId}`);
  log(player, `Player Color: ${player.color === 0 ? 'White' : player.color === 1 ? 'Black' : 'Unknown'}`);
  log(player, `\n--- BOARD ---`);
  log(player, formatBoard(u.board, player.color));
  log(player, `\n--- ACTIONS ---`);
  log(player, formatActions(u.actions));
  log(player, `\n--- MY STASH ---`);
  log(player, formatStash(u.stashes, player.color, true));
  log(player, `\n--- OPPONENT STASH ---`);
  log(player, formatStash(u.stashes, 1 - player.color, false));
  log(player, `\n--- MY ON DECK ---`);
  log(player, formatOnDeck(u.onDecks, player.color, true));
  log(player, `\n--- OPPONENT ON DECK ---`);
  log(player, formatOnDeck(u.onDecks, 1 - player.color, false));
  log(player, `================\n`);
  
  // Update game state
  gameId = u.gameId;
  matchId = u.matchId;
  updateGameStatus();
  
  // Check if both players have completed setup
  checkSetupCompletion();
});
  }
}

// Connect a specific player
async function connectPlayer(playerKey) {
  const player = players[playerKey];
  
  if (player.id) {
    log(player, 'Already connected!');
    return;
  }
  
  log(player, 'Connecting...');
  
  await createUser(player);
  await establishSocketConnection(player);
  
  // Enable queue button for this player only
  if (playerKey === 'player1') {
    document.getElementById('queue1').disabled = false;
  } else {
    document.getElementById('queue2').disabled = false;
  }
  
  log(player, 'Ready to join queue');
}

// Join queue for a specific player
async function joinQueue(player) {
  if (!player.id) {
    log(player, 'Error: Not connected');
    return;
  }
  
  if (player.inQueue) {
    log(player, 'Already in queue!');
    return;
  }
  
  log(player, 'Joining quickplay queue...');
  const res = await fetch(`${API}/api/v1/lobby/enterQuickplay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: player.id })
  });
  
  const data = await res.json();
  log(player, `Queue response: ${JSON.stringify(data)}`);
  
  if (data.gameId) {
    // Match found immediately
    gameId = data.gameId;
    matchId = data.matchId;
    updateGameStatus();
    log(player, 'Successfully joined game!');
    
    // Both players are now in a game, so they're not in queue anymore
    players.player1.inQueue = false;
    players.player2.inQueue = false;
    
    log(player, 'Both players removed from queue - game started');
    
    // Reset ready state for new game
    resetReadyState();
    
    // Enable ready buttons for both players when game starts
    enableReadyButtonsForGame();
    
    // Both players are no longer in queue, so show "Join Queue" buttons
    updateQueueButton(players.player1, false);
    updateQueueButton(players.player2, false);
  } else if (data.status === 'queued') {
    // Added to queue, waiting for match
    player.inQueue = true;
    log(player, 'Added to queue, waiting for match...');
    
    // Change button to "Leave Queue"
    updateQueueButton(player, true);
  }
}

// Leave queue for a specific player
async function leaveQueue(player) {
  if (!player.id || !player.inQueue) {
    log(player, 'Not in queue!');
    return;
  }
  
  log(player, 'Leaving queue...');
  
  try {
    const res = await fetch(`${API}/api/v1/lobby/exitQuickplay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: player.id })
    });
    
    if (res.ok) {
      player.inQueue = false;
      log(player, 'Successfully left queue');
      
      // Change button back to "Join Queue"
      updateQueueButton(player, false);
    } else {
      const error = await res.json();
      log(player, `Failed to leave queue: ${error.message}`);
    }
  } catch (err) {
    log(player, `Error leaving queue: ${err.message}`);
  }
}

// Update queue button text and functionality
function updateQueueButton(player, inQueue) {
  if (player.name === 'Player 1') {
    const button = document.getElementById('queue1');
    if (inQueue) {
      button.textContent = '2. Leave Queue';
      button.onclick = () => leaveQueue(player);
    } else {
      button.textContent = '2. Join Queue';
      button.onclick = () => joinQueue(player);
    }
    console.log(`Player 1 queue button updated: ${inQueue ? 'Leave Queue' : 'Join Queue'}`);
  } else {
    const button = document.getElementById('queue2');
    if (inQueue) {
      button.textContent = '2. Leave Queue';
      button.onclick = () => leaveQueue(player);
    } else {
      button.textContent = '2. Join Queue';
      button.onclick = () => joinQueue(player);
    }
    console.log(`Player 2 queue button updated: ${inQueue ? 'Leave Queue' : 'Join Queue'}`);
  }
}

// Mark a player as ready
async function markPlayerReady(player) {
  if (!gameId) {
    log(player, 'Error: No game ID');
    return;
  }
  
  if (player.isReady) {
    log(player, 'Already marked as ready!');
    return;
  }
  
  log(player, 'Marking player as ready...');
  log(player, `Sending ready request: gameId=${gameId}, color=${player.color}`);
  
  try {
    const res = await fetch(`${API}/api/v1/gameAction/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        gameId, 
        color: player.color 
      })
    });
    
    if (res.ok) {
      const responseData = await res.json();
      log(player, `Ready response: ${JSON.stringify(responseData)}`);
      
      player.isReady = true;
      log(player, 'Successfully marked as ready!');
      
      // Update button text to show ready status
      if (player.name === 'Player 1') {
        document.getElementById('ready1').textContent = '3. Ready ✓';
        document.getElementById('ready1').classList.add('ready');
      } else {
        document.getElementById('ready2').textContent = '3. Ready ✓';
        document.getElementById('ready2').classList.add('ready');
      }
      
      // Check if both players are ready
      checkBothPlayersReady();
    } else {
      const error = await res.json();
      log(player, `Failed to mark as ready: ${error.message}`);
      log(player, `Response status: ${res.status}`);
    }
  } catch (err) {
    log(player, `Error marking as ready: ${err.message}`);
  }
}

// Check if both players are ready and enable setup
function checkBothPlayersReady() {
  if (players.player1.isReady && players.player2.isReady) {
    log(players.player1, 'Both players are ready! Setup is now available.');
    log(players.player2, 'Both players are ready! Setup is now available.');
    
    // Enable setup buttons for both players
    document.getElementById('setup1').disabled = false;
    document.getElementById('setup2').disabled = false;
    
    // Update game phase
    gamePhase = 'Ready';
    updateGameStatus();
  }
}

// Reset ready state for new games
function resetReadyState() {
  players.player1.isReady = false;
  players.player2.isReady = false;
  players.player1.inQueue = false;
  players.player2.inQueue = false;
  players.player1.isMoving = false;
  players.player2.isMoving = false;
  
  // Disable ready and setup buttons
  document.getElementById('ready1').disabled = true;
  document.getElementById('ready2').disabled = true;
  document.getElementById('setup1').disabled = true;
  document.getElementById('setup2').disabled = true;
  
  // Reset button text and styling
  document.getElementById('ready1').textContent = '3. Ready';
  document.getElementById('ready2').textContent = '3. Ready';
  document.getElementById('ready1').classList.remove('ready');
  document.getElementById('ready2').classList.remove('ready');
  
  // Reset queue buttons
  updateQueueButton(players.player1, false);
  updateQueueButton(players.player2, false);
}

// Enable ready buttons for both players when a game starts
function enableReadyButtonsForGame() {
  // Both players should be able to ready once a game starts
  document.getElementById('ready1').disabled = false;
  document.getElementById('ready2').disabled = false;
  
  // Log the state change
  console.log('Ready buttons enabled for both players');
  console.log('Player 1 ready button disabled:', document.getElementById('ready1').disabled);
  console.log('Player 2 ready button disabled:', document.getElementById('ready2').disabled);
}

// Check if both players have completed setup
function checkSetupCompletion() {
  // Only check setup completion if we haven't already completed it
  if (gamePhase === 'Setup Complete') {
    return; // Already completed, don't check again
  }
  
  // This function will be called after each game update
  // We'll check if both players have completed setup by looking at the game state
  // For now, we'll assume setup is complete when both setup buttons are disabled
  // In a real implementation, you'd check the game.setupComplete array
  
  const setup1Disabled = document.getElementById('setup1').disabled;
  const setup2Disabled = document.getElementById('setup2').disabled;
  
  if (setup1Disabled && setup2Disabled) {
    // Both players have completed setup
    gamePhase = 'Setup Complete';
    updateGameStatus();
    
    // Enable play action buttons
    document.getElementById('playAction1').disabled = false;
    document.getElementById('playAction2').disabled = false;
    
    // Update button text to show whose turn it is
    updatePlayActionButtons();
    
    // Initialize simple turn-based system (no hardcoded actions)
    actionSequence = [];
    currentActionIndex = 0;
    
    // Log completion to both players
    if (players.player1.logEl) {
      log(players.player1, '🎉 Both players have completed setup! Game is ready to play!');
      log(players.player1, '🎯 White goes first (Player 1). Click "Play Action" to make a move!');
    }
    if (players.player2.logEl) {
      log(players.player2, '🎉 Both players have completed setup! Game is ready to play!');
      log(players.player2, '🎯 White goes first. Wait for Player 1 to make a move.');
    }
  }
}

// Setup game with proper initial stash
async function setupGame(player) {
  if (!gameId) {
    log(player, 'Error: No game ID');
    return;
  }
  
  // Only allow one player to do the setup
  if (gamePhase === 'Setup Complete') {
    log(player, 'Setup already completed!');
    return;
  }
  
  // Prevent multiple setup attempts
  if (document.getElementById('setup1').disabled && document.getElementById('setup2').disabled) {
    log(player, 'Setup already in progress!');
    return;
  }
  
  // Determine which color this player is setting up
  if (player.color === null) {
    log(player, 'Error: Player color not determined yet. Please wait for game update.');
    return;
  }
  
  log(player, `Setting up ${player.color === 0 ? 'white' : 'black'} pieces...`);
  log(player, `Game ID: ${gameId}`);
  
  // Initialize with proper Cloaks Gambit rules
  // Each player starts with: 2 rooks, 2 bishops, 2 knights, 1 king, 1 bomb
  // But for setup, we can only place 5 pieces (one per column)
  const pieces = [
    { color: player.color, identity: 4, row: player.color === 0 ? 0 : 5, col: 0 }, // Rook (identity 4)
    { color: player.color, identity: 3, row: player.color === 0 ? 0 : 5, col: 1 }, // Bishop (identity 3)
    { color: player.color, identity: 1, row: player.color === 0 ? 0 : 5, col: 2 }, // King (identity 1)
    { color: player.color, identity: 5, row: player.color === 0 ? 0 : 5, col: 3 }, // Knight (identity 5)
    { color: player.color, identity: 2, row: player.color === 0 ? 0 : 5, col: 4 }  // Bomb (identity 2)
  ];
  
  try {
    // Setup this player's pieces
    log(player, `Setting up ${player.color === 0 ? 'white' : 'black'} pieces...`);
    log(player, `Pieces: ${JSON.stringify(pieces)}`);
    
    const setupRes = await fetch(`${API}/api/v1/gameAction/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        gameId, 
        color: player.color, 
        pieces: pieces, 
        onDeck: { color: player.color, identity: 4 } // Start with a rook (identity 4)
      })
    });
    
    if (!setupRes.ok) {
      const error = await setupRes.json();
      log(player, `${player.color === 0 ? 'White' : 'Black'} setup failed: ${error.message}`);
      log(player, `Status: ${setupRes.status}`);
      // Re-enable setup buttons on failure
      document.getElementById('setup1').disabled = false;
      document.getElementById('setup2').disabled = false;
      return;
    }
    
    log(player, `${player.color === 0 ? 'White' : 'Black'} setup successful!`);
    
    // Check if both players have completed setup
    log(player, 'Your setup is complete! Waiting for opponent...');
    
    // Disable this player's setup button to prevent double-clicking
    if (player.name === 'Player 1') {
      document.getElementById('setup1').disabled = true;
    } else {
      document.getElementById('setup2').disabled = true;
    }
    
    // Check if both players have completed setup
    // We'll need to wait for a game update to see the current state
    // The setup buttons will be disabled when both players complete setup
    
  } catch (err) {
    log(player, `Setup error: ${err.message}`);
    // Re-enable setup buttons on error
    document.getElementById('setup1').disabled = false;
    document.getElementById('setup2').disabled = false;
  }
}

// Play a simple move action
async function playAction(player) {
  if (gamePhase !== 'Setup Complete') {
    log(player, 'Error: Game not ready for moves yet');
    return;
  }
  
  // Prevent multiple rapid clicks
  if (player.isMoving) {
    log(player, '💡 Tip: Please wait for your move to complete');
    return;
  }
  
  // For now, let's make a simple move from the starting position
  // White moves first, then Black, alternating turns
  const currentTurn = currentActionIndex % 2; // 0 = White, 1 = Black
  
  if (player.color !== currentTurn) {
    log(player, `💡 Tip: It's ${currentTurn === 0 ? 'White' : 'Black'}'s turn, but you are ${player.color === 0 ? 'White' : 'Black'}. Wait for your turn.`);
    return;
  }
  
  // Create a simple move based on whose turn it is
  let moveAction;
  if (currentTurn === 0) {
    // White's turn - move rook from (0,0) to (2,0)
    moveAction = {
      name: 'White moves rook',
      action: 'move',
      params: { 
        color: 0, 
        from: { row: 0, col: 0 }, 
        to: { row: 2, col: 0 }, 
        declaration: 4 // Rook
      }
    };
  } else {
    // Black's turn - move rook from (5,0) to (3,0)
    moveAction = {
      name: 'Black moves rook',
      action: 'move',
      params: { 
        color: 1, 
        from: { row: 5, col: 0 }, 
        to: { row: 3, col: 0 }, 
        declaration: 4 // Rook
      }
    };
  }
  
  log(player, `Playing: ${moveAction.name}`);
  
  // Set moving flag to prevent multiple clicks
  player.isMoving = true;
  
  try {
    const res = await fetch(`${API}/api/v1/gameAction/${moveAction.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, ...moveAction.params })
    });
    
         if (res.ok) {
       log(player, `Action successful: ${moveAction.name}`);
       currentActionIndex++;
       
       // Update turn display for next action
       updateGameStatus();
       updatePlayActionButtons();
       
       // Log whose turn is next
       const nextTurn = currentActionIndex % 2;
       if (nextTurn === 0) {
         log(players.player1, '🎯 White\'s turn next!');
         log(players.player2, '🎯 White\'s turn next!');
       } else {
         log(players.player1, '🎯 Black\'s turn next!');
         log(players.player2, '🎯 Black\'s turn next!');
       }
       
       // Force a game update to redraw the board for both players
       // This will trigger the game:update event and redraw the board
       log(player, '🔄 Board updated - refreshing view...');
       
       // Log the current board state for debugging
       log(player, '📊 Current board state after move:');
       // The board should be updated in the next game:update event
     } else {
      const error = await res.json();
      log(player, `Action failed: ${error.message}`);
      
      // Provide more user-friendly error messages
      if (error.message.includes('Setup not complete')) {
        log(player, '💡 Tip: Both players must complete setup before making moves');
      } else if (error.message.includes('Illegal move')) {
        log(player, '💡 Tip: This move violates the game rules');
      } else if (error.message.includes('Invalid declaration')) {
        log(player, '💡 Tip: The piece declaration does not match the actual piece type');
        log(player, `💡 Debug: Action params: ${JSON.stringify(moveAction.params)}`);
      } else if (error.message.includes('Not this player\'s turn')) {
        log(player, '💡 Tip: Wait for your turn to make a move');
      }
    }
  } catch (err) {
    log(player, `Error executing action: ${err.message}`);
  } finally {
    // Always reset the moving flag
    player.isMoving = false;
  }
}

// Event listeners
document.getElementById('connect1').onclick = () => connectPlayer('player1');
document.getElementById('connect2').onclick = () => connectPlayer('player2');
document.getElementById('queue1').onclick = () => joinQueue(players.player1);
document.getElementById('queue2').onclick = () => joinQueue(players.player2);
document.getElementById('ready1').onclick = () => markPlayerReady(players.player1);
document.getElementById('ready2').onclick = () => markPlayerReady(players.player2);
document.getElementById('setup1').onclick = () => setupGame(players.player1);
document.getElementById('setup2').onclick = () => setupGame(players.player2);
document.getElementById('playAction1').onclick = () => playAction(players.player1);
document.getElementById('playAction2').onclick = () => playAction(players.player2);

// Initialize queue buttons with correct text
updateQueueButton(players.player1, false);
updateQueueButton(players.player2, false);

// Formatting functions for better readability
function formatBoard(board, playerColor) {
  if (!board || !Array.isArray(board)) return 'No board data';
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    let boardStr = '';
    for (let row = 0; row < board.length; row++) {
      boardStr += `${row}: `;
      for (let col = 0; col < board[row].length; col++) {
        const piece = board[row][col];
        if (piece) {
          boardStr += `[${colorSymbols[piece.color]}?] `;
        } else {
          boardStr += '[ ] ';
        }
      }
      boardStr += '\n';
    }
    return boardStr;
  }
  
  let boardStr = '';
  for (let row = 0; row < board.length; row++) {
    boardStr += `${row}: `;
    for (let col = 0; col < board[row].length; col++) {
      const piece = board[row][col];
      if (piece) {
        // Show piece identity only if it's the player's piece
        if (piece.color === playerColor) {
          // Use ? for unknown pieces, actual symbols for known pieces
          const symbol = piece.identity === 0 ? '?' : 
                        piece.identity === 1 ? '♔' : // King
                        piece.identity === 2 ? '💣' : // Bomb
                        piece.identity === 3 ? '♗' : // Bishop
                        piece.identity === 4 ? '♖' : // Rook
                        piece.identity === 5 ? '♘' : // Knight
                        '?';
          boardStr += `[${colorSymbols[piece.color]}${symbol}] `;
        } else {
          // Opponent's piece - show as unknown
          boardStr += `[${colorSymbols[piece.color]}?] `;
        }
      } else {
        boardStr += '[ ] ';
      }
    }
    boardStr += '\n';
  }
  return boardStr;
}

function formatActions(actions) {
  if (!actions || !Array.isArray(actions)) return 'No actions';
  if (actions.length === 0) return 'No actions yet';
  
  return actions.map((action, index) => {
    const player = action.player === 0 ? 'W' : 'B';
    
    switch (action.type) {
      case 0: // SETUP
        return `${index + 1}. ${player}: Setup`;
      case 1: // MOVE
        if (action.details && action.details.from && action.details.to) {
          const from = `${String.fromCharCode(65 + action.details.from.col)}${action.details.from.row + 1}`;
          const to = `${String.fromCharCode(65 + action.details.to.col)}${action.details.to.row + 1}`;
          const piece = getPieceName(action.details.declaration);
          return `${index + 1}. ${player}: ${from}→${to} "${piece}"`;
        }
        return `${index + 1}. ${player}: Move`;
      case 2: // CHALLENGE
        return `${index + 1}. ${player}: Challenge`;
      case 3: // BOMB
        return `${index + 1}. ${player}: Bomb`;
      case 4: // PASS
        return `${index + 1}. ${player}: Pass`;
      case 5: // ON_DECK
        if (action.details && action.details.piece) {
          const piece = getPieceName(action.details.piece.identity);
          return `${index + 1}. ${player}: On-Deck ${piece}`;
        }
        return `${index + 1}. ${player}: On-Deck`;
      case 6: // RESIGN
        return `${index + 1}. ${player}: Resign`;
      case 7: // READY
        return `${index + 1}. ${player}: Ready`;
      default:
        return `${index + 1}. ${player}: Action ${action.type}`;
    }
  }).join('\n');
}

// Helper function to get piece names
function getPieceName(identity) {
  switch (identity) {
    case 1: return 'King';
    case 2: return 'Bomb';
    case 3: return 'Bishop';
    case 4: return 'Rook';
    case 5: return 'Knight';
    default: return 'Unknown';
  }
}

function formatStash(stashes, playerColor, isOwnStash) {
  if (!stashes || !Array.isArray(stashes) || stashes.length !== 2) return 'No stash data';
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    return 'Player color not determined yet';
  }
  
  const stash = stashes[playerColor];
  if (!stash || stash.length === 0) return 'Stash is empty';
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // Format as a 2x4 grid for better readability
  let result = '';
  for (let row = 0; row < 2; row++) {
    result += `${row}: `;
    for (let col = 0; col < 4; col++) {
      const index = row * 4 + col;
      if (index < stash.length) {
        const piece = stash[index];
        const colorSymbol = colorSymbols[piece.color] || '?';
        
        if (isOwnStash) {
          // Show actual piece identity
          const symbol = piece.identity === 0 ? '?' : 
                        piece.identity === 1 ? '♔' : // King
                        piece.identity === 2 ? '💣' : // Bomb
                        piece.identity === 3 ? '♗' : // Bishop
                        piece.identity === 4 ? '♖' : // Rook
                        piece.identity === 5 ? '♘' : // Knight
                        '?';
          result += `[${colorSymbol}${symbol}] `;
        } else {
          // Show as unknown
          result += `[${colorSymbol}?] `;
        }
      } else {
        result += '[ ] ';
      }
    }
    result += '\n';
  }
  
  return result;
}

function formatOnDeck(onDecks, playerColor, isOwnOnDeck) {
  if (!onDecks || !Array.isArray(onDecks) || onDecks.length !== 2) return 'No on-deck piece';
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    return 'Player color not determined yet';
  }
  
  const onDeck = onDecks[playerColor];
  if (!onDeck) return 'No on-deck piece';
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // Show only the relevant player's on-deck piece
  const colorSymbol = colorSymbols[onDeck.color] || '?';
  
  if (isOwnOnDeck) {
    // Show actual piece identity for own on-deck piece
    const symbol = onDeck.identity === 0 ? '?' : 
                  onDeck.identity === 1 ? '♔' : // King
                  onDeck.identity === 2 ? '💣' : // Bomb
                  onDeck.identity === 3 ? '♗' : // Bishop
                  onDeck.identity === 4 ? '♖' : // Rook
                  onDeck.identity === 5 ? '♘' : // Knight
                  '?';
    return `0: [${colorSymbol}${symbol}]`;
  } else {
    // Show as unknown for opponent's on-deck piece
    return `0: [${colorSymbol}?]`;
  }
}

// Update play action buttons to show whose turn it is
function updatePlayActionButtons() {
  if (gamePhase === 'Setup Complete') {
    const currentTurn = currentActionIndex % 2; // 0 = White, 1 = Black
    
    if (currentTurn === 0) {
      // White's turn
      document.getElementById('playAction1').textContent = '5. Play Action (Your Turn!)';
      document.getElementById('playAction2').textContent = '5. Play Action (Wait for White)';
    } else {
      // Black's turn
      document.getElementById('playAction1').textContent = '5. Play Action (Wait for Black)';
      document.getElementById('playAction2').textContent = '5. Play Action (Your Turn!)';
    }
  }
}



// Initialize the interface
updateGameStatus();
resetReadyState(); // Ensure buttons start in correct state
