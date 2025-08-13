const API = 'http://localhost:3000';

// Player objects with their own log elements and state
const players = {
  player1: {
    id: null,
    socket: null,
    serverLogEl: document.getElementById('serverLog1'),
    actionHistoryEl: document.getElementById('actionHistory1'),
    gameStateEl: document.getElementById('gameState1'),
    color: null, // Will be determined by the game
    name: 'Player 1',
    isReady: false,
    inQueue: false,
    isMoving: false
  },
  player2: {
    id: null,
    socket: null,
    serverLogEl: document.getElementById('serverLog2'),
    actionHistoryEl: document.getElementById('actionHistory2'),
    gameStateEl: document.getElementById('gameState2'),
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
let setupCompletionChecked = false; // Flag to prevent multiple setup completion checks
let incompleteMove = null; // Track incomplete move: { from: {row, col}, to: {row, col}, color: 0/1 }
let lastActionType = null; // Track the last action type: 'move', 'challenge', 'bomb', 'pass', 'onDeck'
let lastActionPlayer = null; // Track who made the last action
let pendingOnDeck = null; // Track if a player needs to go on-deck after a failed challenge
let gameState = {
  lastMove: null, // Store the last move for persistence
  lastAction: null, // Store the last action for persistence
  turnState: 'normal' // 'normal', 'challenge', 'bomb', 'onDeck'
};

// Logging functions for each player
function log(player, msg) {
  console.log(`[${player.name}] ${msg}`);
}

// Log server messages to the server log
function logServerMessage(player, msg) {
  const logEl = player.serverLogEl;
  logEl.textContent += `\n${new Date().toLocaleTimeString()}: ${msg}`;
  logEl.scrollTop = logEl.scrollHeight;
}

// Update action history (shared between both players)
function updateActionHistory(actions) {
  const actionHistory = formatActions(actions);
  players.player1.actionHistoryEl.textContent = actionHistory;
  players.player2.actionHistoryEl.textContent = actionHistory;
}

// Update game state for a specific player
function updateGameState(player, board, stashes, onDecks, daggers) {
  const gameStateEl = player.gameStateEl;
  
  // Store the last game state for refreshing displays
  player.lastBoard = board;
  player.lastStashes = stashes;
  player.lastOnDecks = onDecks;
  player.lastDaggers = daggers; // Store daggers
  
  // Store the incomplete move state persistently
  if (incompleteMove) {
    gameState.lastMove = incompleteMove;
  }
  
  // Populate on-deck dropdowns with current stash contents
  populateOnDeckDropdowns(stashes);
  
  let stateText = '--- DAGGERS ---\n';
  stateText += `My Daggers: ${countDaggers(daggers, player.color)} | Opponent Daggers: ${countDaggers(daggers, 1 - player.color)}\n`;
  stateText += '\n--- BOARD ---\n';
  stateText += formatBoard(board, player.color);
  stateText += '\n--- MY STASH ---\n';
  stateText += formatStash(stashes, player.color, true);
  stateText += '\n--- MY ON DECK ---\n';
  stateText += formatOnDeck(onDecks, player.color, true);
  stateText += '\n--- CAPTURED PIECES ---\n';
  stateText += formatCapturedPieces(stashes, onDecks);
  
  gameStateEl.textContent = stateText;
  gameStateEl.scrollTop = gameStateEl.scrollHeight;
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
   logServerMessage(player, `User created: ${data._id}`);
   return data;
}

// Establish socket connection for a player
async function establishSocketConnection(player) {
  if (player.id) {
    const socket = io('http://localhost:3000', { auth: { userId: player.id } });
    
         socket.on('connect', () => {
       logServerMessage(player, 'Socket connected');
       player.socket = socket;
     });
    
         socket.on('match:found', (m) => {
       logServerMessage(player, `Match found: game ${m.gameId}`);
       gameId = m.gameId;
       matchId = m.matchId;
       updateGameStatus();
       
       // Both players are now in a game, so they're not in queue anymore
       players.player1.inQueue = false;
       players.player2.inQueue = false;
       
       logServerMessage(player, 'Both players removed from queue - game started');
       
       // Reset ready state for new game
       resetReadyState();
       
       // Enable ready buttons for both players when game starts
       enableReadyButtonsForGame();
       
       // Both players are no longer in queue, so show "Join Queue" buttons
       updateQueueButton(players.player1, false);
       updateQueueButton(players.player2, false);
     });
    
                   socket.on('game:update', (u) => {
            // Log server message
            logServerMessage(player, 'Game update received');
            
            // Clear any incomplete move since we got a new game state
            incompleteMove = null;
            
            // Determine player color from the game data
            if (player.color === null) {
              // Find which player this is based on the game data
              if (u.players && u.players.length === 2) {
                // Try to find the player by their user ID in the game data
                const playerIndex = u.players.findIndex(p => p.toString() === player.id);
                if (playerIndex !== -1) {
                  player.color = playerIndex; // Player 0 is white, Player 1 is black
                  console.log(`Player ${player.name} color set to ${player.color} (${player.color === 0 ? 'white' : 'black'})`);
                } else {
                  // Fallback: use player name as before
                  if (player.name === 'Player 1') {
                    player.color = 0; // Usually Player 1 is white
                  } else {
                    player.color = 1; // Usually Player 2 is black
                  }
                  console.log(`Player ${player.name} color set to ${player.color} (${player.color === 0 ? 'white' : 'black'}) by name fallback`);
                }
              }
            }
            
            // Update action history (shared between both players)
            updateActionHistory(u.actions);
            
            // Update game state for this player
            updateGameState(player, u.board, u.stashes, u.onDecks, u.daggers);
            
            // Update game state
            gameId = u.gameId;
            matchId = u.matchId;
            
            // Debug: Log the current state before setup completion check
            console.log('Before setup completion check:', {
              gamePhase,
              setup1Disabled: document.getElementById('setup1').disabled,
              setup2Disabled: document.getElementById('setup2').disabled,
              setup1Element: document.getElementById('setup1'),
              setup2Element: document.getElementById('setup2')
            });
            
            // Check if both players have completed setup
            checkSetupCompletion();
            
            // Update game status after setup completion check
            updateGameStatus();
            
            // Debug: Log the current state after all updates
            console.log('After game update:', {
              gamePhase,
              setup1Disabled: document.getElementById('setup1').disabled,
              setup2Disabled: document.getElementById('setup2').disabled
            });
          });
  }
}

// Connect a specific player
async function connectPlayer(playerKey) {
  const player = players[playerKey];
  
     if (player.id) {
     logServerMessage(player, 'Already connected!');
     return;
   }
   
   logServerMessage(player, 'Connecting...');
   
   await createUser(player);
   await establishSocketConnection(player);
   
   // Enable queue button for this player only
   if (playerKey === 'player1') {
     document.getElementById('queue1').disabled = false;
   } else {
     document.getElementById('queue2').disabled = false;
   }
   
   logServerMessage(player, 'Ready to join queue');
}

// Join queue for a specific player
async function joinQueue(player) {
     if (!player.id) {
     logServerMessage(player, 'Error: Not connected');
     return;
   }
   
   if (player.inQueue) {
     logServerMessage(player, 'Already in queue!');
     return;
   }
   
   logServerMessage(player, 'Joining quickplay queue...');
   const res = await fetch(`${API}/api/v1/lobby/enterQuickplay`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ userId: player.id })
   });
   
   const data = await res.json();
   logServerMessage(player, `Queue response: ${JSON.stringify(data)}`);
   
   if (data.gameId) {
     // Match found immediately
     gameId = data.gameId;
     matchId = data.matchId;
     updateGameStatus();
     logServerMessage(player, 'Successfully joined game!');
     
     // Both players are now in a game, so they're not in queue anymore
     players.player1.inQueue = false;
     players.player2.inQueue = false;
     
     logServerMessage(player, 'Both players removed from queue - game started');
     
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
     logServerMessage(player, 'Added to queue, waiting for match...');
     
     // Change button to "Leave Queue"
     updateQueueButton(player, true);
   }
}

// Leave queue for a specific player
async function leaveQueue(player) {
     if (!player.id || !player.inQueue) {
     logServerMessage(player, 'Not in queue!');
     return;
   }
   
   logServerMessage(player, 'Leaving queue...');
   
   try {
     const res = await fetch(`${API}/api/v1/lobby/exitQuickplay`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ userId: player.id })
     });
     
     if (res.ok) {
       player.inQueue = false;
       logServerMessage(player, 'Successfully left queue');
       
       // Change button back to "Join Queue"
       updateQueueButton(player, false);
     } else {
       const error = await res.json();
       logServerMessage(player, `Failed to leave queue: ${error.message}`);
     }
   } catch (err) {
     logServerMessage(player, `Error leaving queue: ${err.message}`);
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
     logServerMessage(player, 'Error: No game ID');
     return;
   }
   
   if (player.isReady) {
     logServerMessage(player, 'Already marked as ready!');
     return;
   }
   
   logServerMessage(player, 'Marking player as ready...');
   logServerMessage(player, `Sending ready request: gameId=${gameId}, color=${player.color}`);
   
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
       logServerMessage(player, `Ready response: ${JSON.stringify(responseData)}`);
       
       player.isReady = true;
       logServerMessage(player, 'Successfully marked as ready!');
       
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
       logServerMessage(player, `Failed to mark as ready: ${error.message}`);
       logServerMessage(player, `Response status: ${res.status}`);
     }
   } catch (err) {
     logServerMessage(player, `Error marking as ready: ${err.message}`);
   }
}

// Check if both players are ready and enable setup
function checkBothPlayersReady() {
  if (players.player1.isReady && players.player2.isReady) {
    logServerMessage(players.player1, 'Both players are ready! Setup is now available.');
    logServerMessage(players.player2, 'Both players are ready! Setup is now available.');
    
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
  
  // Reset setup completion flag for new games
  setupCompletionChecked = false;
  
  // Clear any incomplete move
  incompleteMove = null;
  
  // Reset game state variables
  lastActionType = null;
  lastActionPlayer = null;
  pendingOnDeck = null;
  gameState = {
    lastMove: null,
    lastAction: null,
    turnState: 'normal'
  };
  
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
  
  // Disable all action controls
  disableAllActionControls();
}

// Disable all action controls
function disableAllActionControls() {
  const allControls = [
    'move1', 'pass1', 'challenge1', 'bomb1', 'onDeck1',
    'move2', 'pass2', 'challenge2', 'bomb2', 'onDeck2'
  ];
  
  allControls.forEach(controlId => {
    const control = document.getElementById(controlId);
    if (control) {
      control.disabled = true;
      control.style.opacity = '0.5';
    }
  });
  
  const allInputs = [
    'from1', 'to1', 'declaration1',
    'from2', 'to2', 'declaration2'
  ];
  
  allInputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.disabled = true;
      input.style.opacity = '0.5';
    }
  });
  
  // Also disable on-deck dropdowns
  const onDeckDropdowns = ['onDeckPiece1', 'onDeckPiece2'];
  onDeckDropdowns.forEach(dropdownId => {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      dropdown.disabled = true;
      dropdown.style.opacity = '0.5';
    }
  });
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
    console.log('Setup already complete, skipping check');
    return; // Already completed, don't check again
  }
  
  // Prevent multiple calls to this function
  if (setupCompletionChecked) {
    console.log('Setup completion already checked, skipping');
    return;
  }
  
  // Check if both setup buttons are disabled (indicating both players completed setup)
  const setup1Disabled = document.getElementById('setup1').disabled;
  const setup2Disabled = document.getElementById('setup2').disabled;
  
  console.log('Checking setup completion:', { 
    setup1Disabled, 
    setup2Disabled, 
    currentGamePhase: gamePhase,
    setup1Element: document.getElementById('setup1'),
    setup2Element: document.getElementById('setup2'),
    setupCompletionChecked
  });
  
  if (setup1Disabled && setup2Disabled) {
    console.log('Both setup buttons disabled - marking setup complete');
    
    // Mark that we've checked setup completion
    setupCompletionChecked = true;
    
    // Both players have completed setup
    gamePhase = 'Setup Complete';
    
    // Clear any incomplete move
    incompleteMove = null;
    
    // Reset game state for new game
    lastActionType = null;
    lastActionPlayer = null;
    pendingOnDeck = null;
    gameState = {
      lastMove: null,
      lastAction: null,
      turnState: 'normal'
    };
    
    // Update action controls based on whose turn it is
    updateActionControlsWrapper();
    
    // Initialize simple turn-based system (no hardcoded actions)
    actionSequence = [];
    currentActionIndex = 0;
    
    // Log completion to both players
    if (players.player1.serverLogEl) {
      logServerMessage(players.player1, '🎉 Both players have completed setup! Game is ready to play!');
      logServerMessage(players.player1, '🎯 White goes first (Player 1). Use the action controls below to make a move!');
    }
    if (players.player2.serverLogEl) {
      logServerMessage(players.player2, '🎉 Both players have completed setup! Game is ready to play!');
      logServerMessage(players.player2, '🎯 White goes first. Wait for Player 1 to make a move.');
    }
    
    // Update game status after all changes
    updateGameStatus();
    
    console.log('Setup completion marked - gamePhase now:', gamePhase);
  } else {
    console.log('Setup not complete yet - waiting for both players');
  }
}

// Setup game with proper initial stash
async function setupGame(player) {
     if (!gameId) {
     logServerMessage(player, 'Error: No game ID');
     return;
   }
   
   // Only allow one player to do the setup
   if (gamePhase === 'Setup Complete') {
     logServerMessage(player, 'Setup already completed!');
     return;
   }
   
   // Prevent multiple setup attempts
   if (document.getElementById('setup1').disabled && document.getElementById('setup2').disabled) {
     logServerMessage(player, 'Setup already in progress!');
     return;
   }
   
   // Determine which color this player is setting up
   if (player.color === null) {
     logServerMessage(player, 'Error: Player color not determined yet. Please wait for game update.');
     return;
   }
   
   logServerMessage(player, `Setting up ${player.color === 0 ? 'white' : 'black'} pieces...`);
   logServerMessage(player, `Game ID: ${gameId}`);
  
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
     logServerMessage(player, `Setting up ${player.color === 0 ? 'white' : 'black'} pieces...`);
     logServerMessage(player, `Pieces: ${JSON.stringify(pieces)}`);
     
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
       logServerMessage(player, `${player.color === 0 ? 'White' : 'Black'} setup failed: ${error.message}`);
       logServerMessage(player, `Status: ${setupRes.status}`);
       // Re-enable setup buttons on failure
       document.getElementById('setup1').disabled = false;
       document.getElementById('setup2').disabled = false;
       return;
     }
     
     logServerMessage(player, `${player.color === 0 ? 'White' : 'Black'} setup successful!`);
     
     // Check if both players have completed setup
     logServerMessage(player, 'Your setup is complete! Waiting for opponent...');
     
           // Disable this player's setup button to prevent double-clicking
      if (player.name === 'Player 1') {
        document.getElementById('setup1').disabled = true;
        console.log('Player 1 setup button disabled');
      } else {
        document.getElementById('setup2').disabled = true;
        console.log('Player 2 setup button disabled');
      }
      
      // Check if both players have completed setup
      // We'll need to wait for a game update to see the current state
      // The setup buttons will be disabled when both players complete setup
      
      // Debug: Log the current state after disabling setup button
      console.log('After disabling setup button:', {
        gamePhase,
        setup1Disabled: document.getElementById('setup1').disabled,
        setup2Disabled: document.getElementById('setup2').disabled
      });
      
      // Force a check after a short delay to ensure DOM is updated
      setTimeout(() => {
        console.log('Delayed setup completion check:', {
          gamePhase,
          setup1Disabled: document.getElementById('setup1').disabled,
          setup2Disabled: document.getElementById('setup2').disabled
        });
        checkSetupCompletion();
      }, 100);
     
   } catch (err) {
     logServerMessage(player, `Setup error: ${err.message}`);
     // Re-enable setup buttons on error
     document.getElementById('setup1').disabled = false;
     document.getElementById('setup2').disabled = false;
   }
}

// Play a simple move action - REMOVED
/*
async function playAction(player) {
  console.log('playAction called:', { 
    playerName: player.name, 
    gamePhase, 
    setup1Disabled: document.getElementById('setup1').disabled,
    setup2Disabled: document.getElementById('setup2').disabled
  });
  
  if (gamePhase !== 'Setup Complete') {
    logServerMessage(player, `Error: Game not ready for moves yet. Current phase: ${gamePhase}`);
    return;
  }
   
   // Prevent multiple rapid clicks
   if (player.isMoving) {
     logServerMessage(player, '💡 Tip: Please wait for your move to complete');
     return;
   }
   
   // For now, let's make a simple move from the starting position
   // White moves first, then Black, alternating turns
   const currentTurn = currentActionIndex % 2; // 0 = White, 1 = Black
   
   if (player.color !== currentTurn) {
     logServerMessage(player, `💡 Tip: It's ${currentTurn === 0 ? 'White' : 'Black'}'s turn, but you are ${player.color === 0 ? 'White' : 'Black'}. Wait for your turn.`);
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
   
   logServerMessage(player, `Playing: ${moveAction.name}`);
   
   // Set moving flag to prevent multiple clicks
   player.isMoving = true;
  
  try {
    const res = await fetch(`${API}/api/v1/gameAction/${moveAction.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, ...moveAction.params })
    });
    
         if (res.ok) {
       logServerMessage(player, `Action successful: ${moveAction.name}`);
       currentActionIndex++;
       
       // Update turn display for next action
       updateGameStatus();
       updateActionControlsWrapper();
       
       // Log whose turn is next
       const nextTurn = currentActionIndex % 2;
       if (nextTurn === 0) {
         logServerMessage(players.player1, '🎯 White\'s turn next!');
         logServerMessage(players.player2, '🎯 White\'s turn next!');
       } else {
         logServerMessage(players.player1, '🎯 Black\'s turn next!');
         logServerMessage(players.player2, '🎯 Black\'s turn next!');
       }
       
       // Force a game update to redraw the board for both players
       // This will trigger the game:update event and redraw the board
       // Log the current board state for debugging
       logServerMessage(player, '📊 Current board state after move:');
       // The board should be updated in the next game:update event
     } else {
      const error = await res.json();
      logServerMessage(player, `Action failed: ${error.message}`);
      
      // Provide more user-friendly error messages
      if (error.message.includes('Setup not complete')) {
        logServerMessage(player, '💡 Tip: Both players must complete setup before making moves');
              } else if (error.message.includes('Illegal move')) {
          logServerMessage(player, '💡 Tip: This move violates the game rules');
        } else if (error.message.includes('Invalid declaration')) {
          logServerMessage(player, '💡 Tip: The piece declaration does not match the actual piece type');
          logServerMessage(player, `💡 Debug: Action params: ${JSON.stringify(moveAction.params)}`);
        } else if (error.message.includes('Not this player\'s turn')) {
          logServerMessage(player, '💡 Tip: Wait for your turn to make a move');
        }
    }
  } catch (err) {
    logServerMessage(player, `Error executing action: ${err.message}`);
  } finally {
    // Always reset the moving flag
    player.isMoving = false;
  }
}
*/

// Event listeners
document.getElementById('connect1').onclick = () => connectPlayer('player1');
document.getElementById('connect2').onclick = () => connectPlayer('player2');
document.getElementById('queue1').onclick = () => joinQueue(players.player1);
document.getElementById('queue2').onclick = () => joinQueue(players.player2);
document.getElementById('ready1').onclick = () => markPlayerReady(players.player1);
document.getElementById('ready2').onclick = () => markPlayerReady(players.player2);
document.getElementById('setup1').onclick = () => setupGame(players.player1);
document.getElementById('setup2').onclick = () => setupGame(players.player2);

// Action button event listeners for Player 1
document.getElementById('move1').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeMove(players.player1, 
      document.getElementById('from1'), 
      document.getElementById('to1'), 
      document.getElementById('declaration1')
    );
  } else {
    logServerMessage(players.player1, 'Game not ready for moves yet');
  }
};
document.getElementById('pass1').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executePass(players.player1);
  } else {
    logServerMessage(players.player1, 'Game not ready for actions yet');
  }
};
document.getElementById('challenge1').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeChallenge(players.player1);
  } else {
    logServerMessage(players.player1, 'Game not ready for actions yet');
  }
};
document.getElementById('bomb1').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeBomb(players.player1);
  } else {
    logServerMessage(players.player1, 'Game not ready for actions yet');
  }
};

// Action button event listeners for Player 2
document.getElementById('move2').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeMove(players.player2, 
      document.getElementById('from2'), 
      document.getElementById('to2'), 
      document.getElementById('declaration2')
    );
  } else {
    logServerMessage(players.player2, 'Game not ready for moves yet');
  }
};
document.getElementById('pass2').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executePass(players.player2);
  } else {
    logServerMessage(players.player2, 'Game not ready for actions yet');
  }
};
document.getElementById('challenge2').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeChallenge(players.player2);
  } else {
    logServerMessage(players.player2, 'Game not ready for actions yet');
  }
};
document.getElementById('bomb2').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeBomb(players.player2);
  } else {
    logServerMessage(players.player2, 'Game not ready for actions yet');
  }
};

// On-deck button event listeners
document.getElementById('onDeck1').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeOnDeck(players.player1);
  } else {
    logServerMessage(players.player1, 'Game not ready for on-deck yet');
  }
};

document.getElementById('onDeck2').onclick = () => {
  if (gamePhase === 'Setup Complete') {
    executeOnDeck(players.player2);
  } else {
    logServerMessage(players.player2, 'Game not ready for on-deck yet');
  }
};

// Coordinate conversion functions
function chessToCoordinates(chessNotation) {
  if (!chessNotation || chessNotation.length !== 2) {
    throw new Error('Invalid chess notation. Use format like A1, B3, etc.');
  }
  
  const file = chessNotation.charAt(0).toUpperCase();
  const rank = chessNotation.charAt(1);
  
  if (file < 'A' || file > 'E') {
    throw new Error('File must be A-E');
  }
  
  if (rank < '1' || rank > '6') {
    throw new Error('Rank must be 1-6');
  }
  
  const col = file.charCodeAt(0) - 'A'.charCodeAt(0);
  const row = parseInt(rank) - 1;
  
  return { row, col };
}

function coordinatesToChess(row, col) {
  const file = String.fromCharCode('A'.charCodeAt(0) + col);
  const rank = row + 1;
  return file + rank;
}

// Action execution functions
async function executeMove(player, fromInput, toInput, declarationSelect) {
  try {
    const from = chessToCoordinates(fromInput.value);
    const to = chessToCoordinates(toInput.value);
    const declaration = parseInt(declarationSelect.value);
    
    logServerMessage(player, `Executing move: ${fromInput.value}→${toInput.value} (${getPieceName(declaration)})`);
    
    // Set incomplete move to show X on board
    incompleteMove = { from, to, color: player.color };
    
    // Update the board display to show the X immediately
    if (players.player1.gameStateEl) {
      updateGameState(players.player1, players.player1.lastBoard || [], players.player1.lastStashes || [], players.player1.lastOnDecks || [], players.player1.lastDaggers || []);
    }
    if (players.player2.gameStateEl) {
      updateGameState(players.player2, players.player2.lastBoard || [], players.player2.lastStashes || [], players.player2.lastOnDecks || [], players.player2.lastDaggers || []);
    }
    
    const res = await fetch(`${API}/api/v1/gameAction/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId,
        color: player.color,
        from,
        to,
        declaration
      })
    });
    
    if (res.ok) {
      logServerMessage(player, 'Move successful!');
      // Store the move state
      lastActionType = 'move';
      lastActionPlayer = player.color;
      gameState.turnState = 'normal';
      
      // In Cloaks Gambit, moves don't immediately change turn
      // The opponent can now challenge, bomb, or make a move
      // Don't increment currentActionIndex yet
      
      // Clear incomplete move since it's now complete
      incompleteMove = null;
      gameState.lastMove = null;
      
      updateGameStatus();
      updateActionControlsWrapper();
    } else {
      const error = await res.json();
      logServerMessage(player, `Move failed: ${error.message}`);
      // Clear incomplete move since it failed
      incompleteMove = null;
    }
  } catch (err) {
    logServerMessage(player, `Move error: ${err.message}`);
    // Clear incomplete move on error
    incompleteMove = null;
  }
}

async function executePass(player) {
  try {
    logServerMessage(player, 'Executing pass action');
    
    // Clear any incomplete move
    incompleteMove = null;
    
    const res = await fetch(`${API}/api/v1/gameAction/pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, color: player.color })
    });
    
    if (res.ok) {
      logServerMessage(player, 'Pass successful!');
      lastActionType = 'pass';
      lastActionPlayer = player.color;
      
      // If this was after a bomb, turn goes back to the bomber
      if (gameState.turnState === 'bomb' && lastActionPlayer !== player.color) {
        logServerMessage(player, 'Turn returns to the player who declared bomb.');
        currentActionIndex = lastActionPlayer;
        gameState.turnState = 'normal';
      } else {
        // Normal pass - increment turn
        currentActionIndex++;
      }
      
      updateGameStatus();
      updateActionControlsWrapper();
    } else {
      const error = await res.json();
      logServerMessage(player, `Pass failed: ${error.message}`);
    }
  } catch (err) {
    logServerMessage(player, `Pass error: ${err.message}`);
  }
}

async function executeChallenge(player) {
  try {
    logServerMessage(player, 'Executing challenge action');
    
    // Clear any incomplete move
    incompleteMove = null;
    
    const res = await fetch(`${API}/api/v1/gameAction/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, color: player.color })
    });
    
    if (res.ok) {
      const responseData = await res.json();
      logServerMessage(player, `Challenge response: ${JSON.stringify(responseData)}`);
      
      lastActionType = 'challenge';
      lastActionPlayer = player.color;
      
      // Check if challenge was successful
      if (responseData.success) {
        logServerMessage(player, 'Challenge successful! Turn now goes to challenger.');
        gameState.turnState = 'challenge';
        // Turn goes to challenger (current player)
        currentActionIndex = player.color;
        pendingOnDeck = null;
      } else {
        logServerMessage(player, 'Challenge failed! Original mover must go on-deck.');
        gameState.turnState = 'onDeck';
        // Original mover must go on-deck
        pendingOnDeck = {
          mover: lastActionPlayer,
          challenger: player.color
        };
        // Turn stays with challenger until on-deck is resolved
        currentActionIndex = player.color;
      }
      
      updateGameStatus();
      updateActionControlsWrapper();
    } else {
      const error = await res.json();
      logServerMessage(player, `Challenge failed: ${error.message}`);
    }
  } catch (err) {
    logServerMessage(player, `Challenge error: ${err.message}`);
  }
}

async function executeBomb(player) {
  try {
    logServerMessage(player, 'Executing bomb action');
    
    // Clear any incomplete move
    incompleteMove = null;
    
    const res = await fetch(`${API}/api/v1/gameAction/bomb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, color: player.color })
    });
    
    if (res.ok) {
      logServerMessage(player, 'Bomb successful!');
      // Bomb action changes turn to opponent
      lastActionType = 'bomb';
      lastActionPlayer = player.color;
      gameState.turnState = 'bomb';
      // Don't increment currentActionIndex - turn goes to opponent
      updateGameStatus();
      updateActionControlsWrapper();
    } else {
      const error = await res.json();
      logServerMessage(player, `Bomb failed: ${error.message}`);
    }
  } catch (err) {
    logServerMessage(player, `Bomb error: ${err.message}`);
  }
}

async function executeOnDeck(player) {
  try {
    const onDeckSelect = document.getElementById(`onDeckPiece${player.name === 'Player 1' ? '1' : '2'}`);
    const pieceIdentity = parseInt(onDeckSelect.value);
    
    if (!pieceIdentity) {
      logServerMessage(player, 'Please select a piece to place on deck');
      return;
    }
    
    logServerMessage(player, `Placing ${getPieceName(pieceIdentity)} on deck`);
    
    // Clear any incomplete move
    incompleteMove = null;
    
    const res = await fetch(`${API}/api/v1/gameAction/onDeck`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        gameId, 
        color: player.color,
        piece: { color: player.color, identity: pieceIdentity }
      })
    });
    
    if (res.ok) {
      logServerMessage(player, 'On-deck successful!');
      lastActionType = 'onDeck';
      lastActionPlayer = player.color;
      gameState.turnState = 'normal';
      
      // After on-deck, turn goes to the challenger (if there was a challenge)
      if (pendingOnDeck && pendingOnDeck.challenger !== player.color) {
        // Turn goes to challenger
        currentActionIndex = pendingOnDeck.challenger;
        pendingOnDeck = null;
      } else {
        // Normal turn progression
        currentActionIndex++;
      }
      
      updateGameStatus();
      updateActionControlsWrapper();
    } else {
      const error = await res.json();
      logServerMessage(player, `On-deck failed: ${error.message}`);
    }
  } catch (err) {
    logServerMessage(player, `On-deck error: ${err.message}`);
  }
}

// Initialize queue buttons with correct text
updateQueueButton(players.player1, false);
updateQueueButton(players.player2, false);

// Formatting functions for better readability
function formatBoard(board, playerColor) {
  if (!board || !Array.isArray(board)) return 'No board data';
  
  console.log('formatBoard called with playerColor:', playerColor);
  console.log('Board data:', board);
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    console.log('Player color is null, showing all pieces as unknown');
    let boardStr = '';
    // Add file labels at the top
    boardStr += '    ';
    for (let col = 0; col < board[0].length; col++) {
      const file = String.fromCharCode('A'.charCodeAt(0) + col);
      boardStr += ` ${file}  `;
    }
    boardStr += '\n';
    
    for (let row = board.length - 1; row >= 0; row--) {
      // Add rank label on the left
      const rank = row + 1;
      boardStr += `${rank}: `;
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
    
    // Add file labels at the bottom
    boardStr += '    ';
    for (let col = 0; col < board[0].length; col++) {
      const file = String.fromCharCode('A'.charCodeAt(0) + col);
      boardStr += ` ${file}  `;
    }
    boardStr += '\n';
    
    return boardStr;
  }
  
  let boardStr = '';
  
  // Add file labels at the top
  boardStr += '    ';
  for (let col = 0; col < board[0].length; col++) {
    const file = String.fromCharCode('A'.charCodeAt(0) + col);
    boardStr += ` ${file}  `;
  }
  boardStr += '\n';
  
      for (let row = board.length - 1; row >= 0; row--) {
        // Add rank label on the left
        const rank = row + 1;
        boardStr += `${rank}: `;
        for (let col = 0; col < board[row].length; col++) {
          const piece = board[row][col];
          if (piece) {
            console.log(`Piece at [${row},${col}]:`, piece, 'playerColor:', playerColor, 'piece.color === playerColor:', piece.color === playerColor);
            // Show piece identity only if it's the player's piece
            if (piece.color === playerColor) {
              // Use actual piece symbols for known pieces
              const symbol = piece.identity === 1 ? '♔' : // King
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
            // Check if this is the target of an incomplete move
            if (isIncompleteMoveTarget(row, col)) {
              boardStr += '[X] ';
            } else {
              boardStr += '[ ] ';
            }
          }
        }
        boardStr += '\n';
      }
  
  // Add file labels at the bottom
  boardStr += '    ';
  for (let col = 0; col < board[0].length; col++) {
    const file = String.fromCharCode('A'.charCodeAt(0) + col);
    boardStr += ` ${file}  `;
  }
  boardStr += '\n';
  
  return boardStr;
}

// Check if a position is the target of an incomplete move
function isIncompleteMoveTarget(row, col) {
  // Check current incomplete move first
  if (incompleteMove && incompleteMove.to.row === row && incompleteMove.to.col === col) {
    return true;
  }
  
  // Check persistent incomplete move state
  if (gameState.lastMove && gameState.lastMove.to.row === row && gameState.lastMove.to.col === col) {
    return true;
  }
  
  return false;
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
  console.log('formatStash called with:', { stashes, playerColor, isOwnStash });
  
  if (!stashes || !Array.isArray(stashes) || stashes.length !== 2) return 'No stash data';
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    console.log('Player color is null in formatStash');
    return 'Player color not determined yet';
  }
  
  const stash = stashes[playerColor];
  console.log('Stash for player color', playerColor, ':', stash);
  
  if (!stash || stash.length === 0) return 'Stash is empty';
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // Only show actual pieces, not empty slots
  let result = '';
  let pieceCount = 0;
  
  for (let i = 0; i < stash.length; i++) {
    const piece = stash[i];
    console.log(`Stash piece ${i}:`, piece);
    if (piece && piece.identity !== 0) { // Only show pieces with actual identities
      pieceCount++;
      const colorSymbol = colorSymbols[piece.color] || '?';
      
      if (isOwnStash) {
        // Show actual piece identity
        const symbol = piece.identity === 1 ? '♔' : // King
                      piece.identity === 2 ? '💣' : // Bomb
                      piece.identity === 3 ? '♗' : // Bishop
                      piece.identity === 4 ? '♖' : // Rook
                      piece.identity === 5 ? '♘' : // Knight
                      '?';
        result += `${pieceCount}. [${colorSymbol}${symbol}] `;
      } else {
        // Show as unknown for opponent
        result += `${pieceCount}. [${colorSymbol}?] `;
      }
    }
  }
  
  if (pieceCount === 0) {
    return 'Stash is empty';
  }
  
  return result;
}

function formatOnDeck(onDecks, playerColor, isOwnOnDeck) {
  console.log('formatOnDeck called with:', { onDecks, playerColor, isOwnOnDeck });
  
  if (!onDecks || !Array.isArray(onDecks) || onDecks.length !== 2) return 'No on-deck piece';
  
  // If player color is not determined yet, show all pieces as unknown
  if (playerColor === null) {
    console.log('Player color is null in formatOnDeck');
    return 'Player color not determined yet';
  }
  
  const onDeck = onDecks[playerColor];
  console.log('On-deck for player color', playerColor, ':', onDeck);
  
  if (!onDeck || onDeck.identity === 0) return 'No on-deck piece';
  
  const colorSymbols = ['⚪', '⚫']; // White circle, Black circle
  
  // Show only the relevant player's on-deck piece
  const colorSymbol = colorSymbols[onDeck.color] || '?';
  
  if (isOwnOnDeck) {
    // Show actual piece identity for own on-deck piece
    const symbol = onDeck.identity === 1 ? '♔' : // King
                  onDeck.identity === 2 ? '💣' : // Bomb
                  onDeck.identity === 3 ? '♗' : // Bishop
                  onDeck.identity === 4 ? '♖' : // Rook
                  onDeck.identity === 5 ? '♘' : // Knight
                  '?';
    return `[${colorSymbol}${symbol}]`;
  } else {
    // Show as unknown for opponent's on-deck piece
    return `[${colorSymbol}?]`;
  }
}

// Count daggers for a specific player
function countDaggers(daggers, playerColor) {
  if (!daggers || !Array.isArray(daggers) || daggers.length !== 2) return 0;
  return daggers[playerColor] || 0;
}

function formatCapturedPieces(stashes, onDecks) {
  if (!stashes || !Array.isArray(stashes) || stashes.length !== 2) return 'No captured pieces data';
  
  let result = '';
  let capturedPieces = [];
  
  // For now, we'll show a simple message since we need to track actual captures
  // In a real implementation, you'd have a separate captured pieces array
  // or track which pieces were actually captured during gameplay
  
  // This is a placeholder - in a real game you'd track actual captures
  // For now, just show that no pieces have been captured yet
  return 'No pieces captured yet.';
}

// Update action controls based on whose turn it is
function updateActionControlsWrapper() {
  if (gamePhase === 'Setup Complete') {
    const currentTurn = currentActionIndex % 2; // 0 = White, 1 = Black
    updateActionControls(currentTurn);
  }
}

// Update action controls based on whose turn it is and game state
function updateActionControls(currentTurn) {
  const isPlayer1Turn = currentTurn === 0;
  const isPlayer2Turn = currentTurn === 1;
  
  // Get current player and opponent
  const currentPlayer = isPlayer1Turn ? players.player1 : players.player2;
  const opponent = isPlayer1Turn ? players.player2 : players.player1;
  
  // Determine what actions are available based on game state
  let availableActions = [];
  
  if (gameState.turnState === 'normal') {
    // Normal turn - player can move, opponent can challenge/bomb
    if (isPlayer1Turn) {
      availableActions = ['move1', 'onDeck1'];
      // Opponent can challenge/bomb
      if (lastActionType === 'move') {
        availableActions.push('challenge2', 'bomb2');
      }
    } else {
      availableActions = ['move2', 'onDeck2'];
      // Opponent can challenge/bomb
      if (lastActionType === 'move') {
        availableActions.push('challenge1', 'bomb1');
      }
    }
  } else if (gameState.turnState === 'challenge') {
    // After successful challenge - challenger can only move
    if (isPlayer1Turn) {
      availableActions = ['move1'];
    } else {
      availableActions = ['move2'];
    }
  } else if (gameState.turnState === 'bomb') {
    // After bomb - opponent can pass or challenge
    if (isPlayer1Turn) {
      availableActions = ['pass1', 'challenge1'];
    } else {
      availableActions = ['pass2', 'challenge2'];
    }
  } else if (gameState.turnState === 'onDeck') {
    // After failed challenge - original mover must go on-deck
    if (pendingOnDeck && pendingOnDeck.mover === currentTurn) {
      if (isPlayer1Turn) {
        availableActions = ['onDeck1'];
      } else {
        availableActions = ['onDeck2'];
      }
    }
  }
  
  // Enable/disable all controls based on availability
  const allControls = [
    'move1', 'pass1', 'challenge1', 'bomb1', 'onDeck1',
    'move2', 'pass2', 'challenge2', 'bomb2', 'onDeck2'
  ];
  
  allControls.forEach(controlId => {
    const control = document.getElementById(controlId);
    if (control) {
      const isAvailable = availableActions.includes(controlId);
      control.disabled = !isAvailable;
      control.style.opacity = isAvailable ? '1' : '0.5';
    }
  });
  
  // Enable/disable coordinate inputs based on whose turn it is
  const player1Inputs = ['from1', 'to1', 'declaration1'];
  player1Inputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.disabled = !isPlayer1Turn;
      input.style.opacity = isPlayer1Turn ? '1' : '0.5';
    }
  });
  
  const player2Inputs = ['from2', 'to2', 'declaration2'];
  player2Inputs.forEach(inputId => {
    const input = document.getElementById(inputId);
    if (input) {
      input.disabled = !isPlayer2Turn;
      input.style.opacity = isPlayer2Turn ? '1' : '0.5';
    }
  });
  
  // Enable/disable on-deck dropdowns
  const onDeckDropdowns = ['onDeckPiece1', 'onDeckPiece2'];
  onDeckDropdowns.forEach(dropdownId => {
    const dropdown = document.getElementById(dropdownId);
    if (dropdown) {
      const isPlayer1Dropdown = dropdownId === 'onDeckPiece1';
      const isAvailable = (isPlayer1Dropdown && isPlayer1Turn) || (!isPlayer1Dropdown && isPlayer2Turn);
      dropdown.disabled = !isAvailable;
      dropdown.style.opacity = isAvailable ? '1' : '0.5';
    }
  });
}

// Populate on-deck piece dropdowns based on stash contents
function populateOnDeckDropdowns(stashes) {
  if (!stashes || !Array.isArray(stashes) || stashes.length !== 2) return;
  
  // Populate Player 1 dropdown
  const dropdown1 = document.getElementById('onDeckPiece1');
  if (dropdown1) {
    dropdown1.innerHTML = '<option value="">Select piece from stash...</option>';
    const stash1 = stashes[0]; // Player 1 stash
    if (stash1 && Array.isArray(stash1)) {
      stash1.forEach((piece, index) => {
        if (piece && piece.identity !== 0) {
          const pieceName = getPieceName(piece.identity);
          const option = document.createElement('option');
          option.value = piece.identity;
          option.textContent = `${pieceName} (${piece.identity})`;
          dropdown1.appendChild(option);
        }
      });
    }
  }
  
  // Populate Player 2 dropdown
  const dropdown2 = document.getElementById('onDeckPiece2');
  if (dropdown2) {
    dropdown2.innerHTML = '<option value="">Select piece from stash...</option>';
    const stash2 = stashes[1]; // Player 2 stash
    if (stash2 && Array.isArray(stash2)) {
      stash2.forEach((piece, index) => {
        if (piece && piece.identity !== 0) {
          const pieceName = getPieceName(piece.identity);
          const option = document.createElement('option');
          option.value = piece.identity;
          option.textContent = `${pieceName} (${piece.identity})`;
          dropdown2.appendChild(option);
        }
      });
    }
  }
}


// Initialize the interface
updateGameStatus();
resetReadyState(); // Ensure buttons start in correct state
