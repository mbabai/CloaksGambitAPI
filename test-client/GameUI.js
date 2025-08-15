// Game configuration
const BOARD_ROWS = 6;
const BOARD_COLS = 5; // Files
const STASH_ROWS = 2;
const STASH_COLS = 5;

// Target aspect ratio: 17:10
const TARGET_ASPECT_RATIO = 17 / 10;

// Global variables for sizing
let squareSize = 0;
let playAreaWidth = 0;
let playAreaHeight = 0;
let boardWidth = 0;
let boardHeight = 0;

// Piece identities mapping
const PIECE_IDENTITIES = {
    0: '?',    // UNKNOWN
    1: '♔',    // KING
    2: '💣',   // BOMB
    3: '♗',    // BISHOP
    4: '♖',    // ROOK
    5: '♘'     // KNIGHT
};

// Sample game state (this would come from the API)
const sampleGameState = {
    board: [
        [{ color: 0, identity: 1 }, { color: 0, identity: 4 }, null, null, null], // Row 1: King, Rook
        [null, null, null, null, null], // Row 2
        [null, { color: 0, identity: 0 }, null, null, null], // Row 3: Pawn
        [null, null, null, null, { color: 1, identity: 0 }], // Row 4: Black pawn
        [null, null, { color: 1, identity: 0 }, null, null], // Row 5: Black pawn
        [{ color: 1, identity: 0 }, { color: 1, identity: 0 }, { color: 1, identity: 0 }, null, null] // Row 6: Black pawns
    ],
    stashes: [
        // White stash
        [
            { color: 0, identity: 1 }, { color: 0, identity: 2 }, null, { color: 0, identity: 5 }, { color: 0, identity: 5 }
        ],
        // Black stash
        [
            { color: 1, identity: 4 }, { color: 1, identity: 4 }, { color: 1, identity: 3 }, { color: 1, identity: 3 }, { color: 1, identity: 2 }
        ]
    ],
    daggers: [2, 2], // White and black dagger counts
    captured: [
        [{ color: 0, identity: 3 }], // White captured pieces
        [{ color: 1, identity: 0 }, { color: 1, identity: 0 }] // Black captured pieces
    ]
};

// Function to update CSS custom properties for font sizes
function updateFontSizes() {
    const root = document.documentElement;
    
    // Base font size calculation - use the smaller of width or height to ensure readability
    const baseSize = Math.min(playAreaWidth, playAreaHeight);
    
    // Calculate font sizes as percentages of the base size
    // These ratios maintain the current visual proportions - DOUBLED for larger starting sizes
    const playerNameRatio = 0.056; // 48px / 850px (doubled from 0.028)
    const playerClockRatio = 0.070; // 60px / 850px (doubled from 0.035)
    const daggerTokenRatio = 0.032; // 28px / 850px (doubled from 0.016)
    const capturedPieceRatio = 0.042; // 36px / 850px (doubled from 0.021)
    const boardSquareRatio = 0.028; // 24px / 850px (doubled from 0.014)
    const boardPieceRatio = 0.032; // 28px / 850px (doubled from 0.016)
    const stashSlotRatio = 0.028; // 24px / 850px (doubled from 0.014)
    const stashPieceRatio = 0.028; // 24px / 850px (doubled from 0.014)
    const actionButtonRatio = 0.038; // 32px / 850px (doubled from 0.019)
    
    // Update CSS custom properties
    root.style.setProperty('--font-size-player-name', `${baseSize * playerNameRatio}px`);
    root.style.setProperty('--font-size-player-clock', `${baseSize * playerClockRatio}px`);
    root.style.setProperty('--font-size-dagger-token', `${baseSize * daggerTokenRatio}px`);
    root.style.setProperty('--font-size-captured-piece', `${baseSize * capturedPieceRatio}px`);
    root.style.setProperty('--font-size-board-square', `${baseSize * boardSquareRatio}px`);
    root.style.setProperty('--font-size-board-piece', `${baseSize * boardPieceRatio}px`);
    root.style.setProperty('--font-size-stash-slot', `${baseSize * stashSlotRatio}px`);
    root.style.setProperty('--font-size-stash-piece', `${baseSize * stashPieceRatio}px`);
    root.style.setProperty('--font-size-action-button', `${baseSize * actionButtonRatio}px`);
}

// Calculate the optimal play area size based on page dimensions
function calculatePlayAreaSize() {
    const pageWidth = window.innerWidth;
    const pageHeight = window.innerHeight;

    const pageRatio = pageHeight/pageWidth
    const idealRatio = 1.7
    
    // Target aspect ratio is 17:10 (width:height)
    // Always maintain this exact ratio and scale uniformly
    // Leave margins around the play area instead of filling the entire page
    
    let finalWidth, finalHeight;
    
    
    // Use whichever approach gives us the smaller size (fits better)
    if (pageRatio >= idealRatio) {
        // Width is the limiting factor - fit to width
        finalWidth = pageWidth;
        finalHeight = pageWidth*idealRatio;
    } else {
        // Height is the limiting factor - fit to height
        finalHeight = pageHeight;
        finalWidth = pageHeight/idealRatio;
    }
    
    return { width: finalWidth, height: finalHeight };
}

// Calculate square size based on board dimensions
function calculateSquareSize() {
    // Square size = play area width / (F + 1) where F is files (columns)
    // This ensures half-side length on both sides
    let calculatedSize = playAreaWidth / (BOARD_COLS + 1);
    
    // Safety check: ensure the board fits within the play area
    // Since we're maintaining aspect ratio, we can be more generous with board sizing
    const maxBoardWidth = playAreaWidth * 0.9; // Board can use up to 90% of play area width
    const maxBoardHeight = playAreaHeight * 0.7; // Board can use up to 70% of play area height
    
    const maxSquareSizeByWidth = maxBoardWidth / BOARD_COLS;
    const maxSquareSizeByHeight = maxBoardHeight / BOARD_ROWS;
    
    // Use the smaller of the calculated size or the maximum allowed size
    calculatedSize = Math.min(calculatedSize, maxSquareSizeByWidth, maxSquareSizeByHeight);
    
    return calculatedSize;
}

// Position all elements based on calculated sizes
function positionElements() {
    const playArea = document.getElementById('playArea');
    const gameState = document.getElementById('gameState');
    const board = document.getElementById('board');
    const stash = document.getElementById('stash');
    
    // Set play area dimensions and center it on the page
    playArea.style.width = `${playAreaWidth}px`;
    playArea.style.height = `${playAreaHeight}px`;
    
    // Calculate board dimensions
    boardWidth = squareSize * BOARD_COLS;
    boardHeight = squareSize * BOARD_ROWS;
    
    // Position board in center of play area
    const boardLeft = (playAreaWidth - boardWidth) / 2;
    const boardTop = (playAreaHeight - boardHeight) / 2;
    
    board.style.left = `${boardLeft}px`;
    board.style.top = `${boardTop}px`;
    board.style.width = `${boardWidth}px`;
    board.style.height = `${boardHeight}px`;
    board.style.gridTemplateColumns = `repeat(${BOARD_COLS}, ${squareSize}px)`;
    board.style.gridTemplateRows = `repeat(${BOARD_ROWS}, ${squareSize}px)`;
    
    // Position stash below board
    const stashLeft = boardLeft;
    const stashTop = boardTop + boardHeight + 5; // 5px gap
    
    stash.style.left = `${stashLeft}px`;
    stash.style.top = `${stashTop}px`;
    stash.style.width = `${boardWidth}px`;
    stash.style.height = `${squareSize * STASH_ROWS}px`;
    stash.style.gridTemplateColumns = `repeat(${STASH_COLS}, ${squareSize}px)`;
    stash.style.gridTemplateRows = `repeat(${STASH_ROWS}, ${squareSize}px)`;
    
    // Position action buttons below stash
    const actionButtons = document.getElementById('actionButtons');
    const buttonWidth = squareSize * 2.2; // 2.2x square width
    const buttonHeight = squareSize * 1.1; // 1.1x square height
    let actionButtonsTop = squareSize * 8.1; // 10px gap below stash
    
    // Check if action buttons would extend beyond play area
    const totalHeight = boardTop + boardHeight + (squareSize * STASH_ROWS) + 10 + buttonHeight;
    if (totalHeight > playAreaHeight) {
        // If buttons would extend beyond play area, reduce the gap
        const availableSpace = playAreaHeight - (boardTop + boardHeight + (squareSize * STASH_ROWS));
        const adjustedGap = Math.max(5, availableSpace - buttonHeight); // At least 5px gap
        actionButtonsTop = squareSize * 8.1;
    }
    
    actionButtons.style.left = `${stashLeft}px`;
    actionButtons.style.top = `${actionButtonsTop}px`;
    actionButtons.style.width = `${boardWidth}px`;
    actionButtons.style.height = `${buttonHeight}px`;
    
    // Position individual buttons
    const challengeButton = document.getElementById('challengeButton');
    const passButton = document.getElementById('passButton');
    const bombButton = document.getElementById('bombButton');
    
    challengeButton.style.width = `${buttonWidth}px`;
    challengeButton.style.height = `${buttonHeight}px`;
    
    passButton.style.width = `${buttonWidth}px`;
    passButton.style.height = `${buttonHeight}px`;
    
    bombButton.style.width = `${buttonWidth}px`;
    bombButton.style.height = `${buttonHeight}px`;
    // Position bomb button in same location as pass button (it will cover it)
    bombButton.style.position = 'absolute';
    bombButton.style.right = '0px';
    bombButton.style.top = '0px';
    
    // Position game state above board
    const gameStateHeight = squareSize * 1.9; // Reduced from 2.0 to 1.6 for more compact spacing
    const gameStateTop = boardTop - gameStateHeight - 5; // 5px gap above board
    
    gameState.style.top = `${gameStateTop}px`;
    gameState.style.height = `${gameStateHeight}px`;
    
                 // Position left player state - ensure it doesn't go off the left edge
     const leftStateLeft = Math.max(squareSize * 0.25, 10); // At least 10px from left edge
     const leftStateWidth = (playAreaWidth - leftStateLeft - 10) / 2; // Use half of remaining space
     
     const leftPlayerState = document.getElementById('leftPlayerState');
     leftPlayerState.style.left = `${leftStateLeft}px`;
     leftPlayerState.style.width = `${leftStateWidth}px`;
     leftPlayerState.style.height = `${gameStateHeight}px`;
     
     // Position right player state - ensure it doesn't go off the right edge
     const rightStateRight = Math.max(squareSize * 0.25, 10); // At least 10px from right edge
     const rightStateWidth = (playAreaWidth - rightStateRight - 10) / 2; // Use half of remaining space
     
     const rightPlayerState = document.getElementById('rightPlayerState');
     rightPlayerState.style.right = `${rightStateRight}px`;
     rightPlayerState.style.width = `${rightStateWidth}px`;
     rightPlayerState.style.height = `${gameStateHeight}px`;
    
            // Position player names (top of game state)
// 4E: Names should be same height as clocks, aligned to outside of states div
const nameHeight = squareSize * 0.66; // Same height as clocks
const nameWidth = squareSize * 3; // Increased width: 3 squares for more space

const leftPlayerName = document.getElementById('leftPlayerName');
leftPlayerName.style.top = `${nameHeight * 0.15}px`; // Move down by 1/4 of name height to halve the gap
leftPlayerName.style.left = '0px'; // Left aligned with no margin
leftPlayerName.style.width = `${nameWidth}px`;
leftPlayerName.style.height = `${nameHeight}px`;
leftPlayerName.style.padding = '0px';
leftPlayerName.style.margin = '0px';
leftPlayerName.style.position = 'absolute';
leftPlayerName.style.justifyContent = 'flex-start'; // Left align text within the name box

const rightPlayerName = document.getElementById('rightPlayerName');
rightPlayerName.style.top = `${nameHeight * 0.15}px`; // Move down by 1/4 of name height to halve the gap
rightPlayerName.style.right = '0px'; // Right aligned with no margin
rightPlayerName.style.width = `${nameWidth}px`;
rightPlayerName.style.height = `${nameHeight}px`;
rightPlayerName.style.padding = '0px';
rightPlayerName.style.margin = '0px';
rightPlayerName.style.position = 'absolute';
rightPlayerName.style.justifyContent = 'flex-end'; // Right align text within the name box
rightPlayerName.style.textAlign = 'right'; // Additional right alignment for text

// Add spacing between the name boxes to prevent overlap
const nameGap = squareSize * 0.5; // Half a square width as gap
leftPlayerName.style.width = `${nameWidth - nameGap/2}px`; // Reduce left name width slightly
rightPlayerName.style.width = `${nameWidth - nameGap/2}px`; // Reduce right name width slightly

                 // Position clocks (below names)
 // 4C: Height 0.66 of square, width 1.4 squares (30% narrower), aligned to outside
 const clockHeight = squareSize * 0.66;
 const clockWidth = squareSize * 1.4; // Fixed width: 1.4 squares (30% narrower)

        const leftClock = document.getElementById('leftClock');
leftClock.style.top = `${nameHeight + 0.5}px`; // Reduced from 1px to 0.5px margin from name
leftClock.style.left = '0px';
leftClock.style.width = `${clockWidth}px`;
leftClock.style.height = `${clockHeight}px`;
leftClock.style.position = 'absolute';

const rightClock = document.getElementById('rightClock');
rightClock.style.top = `${nameHeight + 0.5}px`; // Reduced from 1px to 0.5px margin from name
rightClock.style.right = '0px';
rightClock.style.width = `${clockWidth}px`;
rightClock.style.height = `${clockHeight}px`;
rightClock.style.position = 'absolute';

// Position dagger spaces (next to clocks)
// 4D: Same height as clocks, split into equal aspect ratio = 1 halves
const daggerHeight = squareSize * 0.66; // Same height as clocks

                 // Calculate total width needed for dagger space (including multiple tokens)
  const leftDaggerCount = sampleGameState.daggers[0];
  const rightDaggerCount = sampleGameState.daggers[1];
  const tokenSize = squareSize * 0.66; // Token size should scale with square size (same as clock height)
  const leftDaggerSpaceWidth = (tokenSize * leftDaggerCount) + (8 * (leftDaggerCount - 1)); // Width + gaps
  const rightDaggerSpaceWidth = (tokenSize * rightDaggerCount) + (8 * (rightDaggerCount - 1)); // Width + gaps

const leftDaggerSpace = document.getElementById('leftDaggerSpace');
leftDaggerSpace.style.top = `${nameHeight + 0.5}px`; // Same level as clocks (reduced margin)
leftDaggerSpace.style.left = `${clockWidth + 2}px`; // 2px to the right of clock
leftDaggerSpace.style.width = `${leftDaggerSpaceWidth}px`;
leftDaggerSpace.style.height = `${daggerHeight}px`;
leftDaggerSpace.style.position = 'absolute';

const rightDaggerSpace = document.getElementById('rightDaggerSpace');
rightDaggerSpace.style.top = `${nameHeight + 0.5}px`; // Same level as clocks (reduced margin)
rightDaggerSpace.style.right = `${clockWidth + 2}px`; // 2px to the left of clock
rightDaggerSpace.style.width = `${rightDaggerSpaceWidth}px`;
rightDaggerSpace.style.height = `${daggerHeight}px`;
rightDaggerSpace.style.position = 'absolute';

                 // Position captures (bottom of game state)
 // 4B: Height 1/2 square, width calculated based on number of pieces, aligned to outside
 const capturesHeight = squareSize * 0.5; // Half square height
 
 // Calculate width needed for captured pieces (each piece is 0.5 square + gaps)
 const leftCapturesCount = sampleGameState.captured[0].length;
 const rightCapturesCount = sampleGameState.captured[1].length;
 const pieceSize = squareSize * 0.5; // Each piece is half square
 const leftCapturesWidth = (pieceSize * leftCapturesCount) + (3 * Math.max(0, leftCapturesCount - 1)); // Width + gaps
 const rightCapturesWidth = (pieceSize * rightCapturesCount) + (3 * Math.max(0, rightCapturesCount - 1)); // Width + gaps

                               const leftCaptures = document.getElementById('leftCaptures');
  leftCaptures.style.bottom = '0px'; // Reduced from 1px to 0px for minimal bottom margin
  leftCaptures.style.left = '0px';
  leftCaptures.style.width = `${leftCapturesWidth}px`;
  leftCaptures.style.height = `${capturesHeight}px`;
  leftCaptures.style.position = 'absolute';
  
  const rightCaptures = document.getElementById('rightCaptures');
  rightCaptures.style.bottom = '0px'; // Reduced from 1px to 0px for minimal bottom margin
  rightCaptures.style.right = '0px';
  rightCaptures.style.width = `${rightCapturesWidth}px`;
  rightCaptures.style.height = `${capturesHeight}px`;
  rightCaptures.style.position = 'absolute';
}

// Generate the game board
function generateBoard() {
    const board = document.getElementById('board');
    board.innerHTML = ''; // Clear existing content
    
    // Generate board squares
    for (let row = 0; row < BOARD_ROWS; row++) {
        for (let col = 0; col < BOARD_COLS; col++) {
            const square = document.createElement('div');
            square.className = `board-square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
            square.style.width = `${squareSize}px`;
            square.style.height = `${squareSize}px`;
            
            // Check if there's a piece on this square
            const piece = sampleGameState.board[row][col];
            if (piece) {
                const pieceElement = document.createElement('div');
                pieceElement.className = `board-piece ${piece.color === 0 ? 'white' : 'black'}`;
                pieceElement.textContent = PIECE_IDENTITIES[piece.identity];
                square.appendChild(pieceElement);
            }
            
            board.appendChild(square);
        }
    }
}

// Generate the stash
function generateStash() {
    const stash = document.getElementById('stash');
    stash.innerHTML = ''; // Clear existing content
    
    // Generate stash slots
    for (let row = 0; row < STASH_ROWS; row++) {
        for (let col = 0; col < STASH_COLS; col++) {
            const slot = document.createElement('div');
            slot.className = 'stash-slot';
            slot.style.width = `${squareSize}px`;
            slot.style.height = `${squareSize}px`;
            
            // Create purple on-deck square in the middle of the top row
            if (row === 0 && col === 2) {
                slot.classList.add('on-deck');
                // Add a piece to the on-deck slot
                const pieceElement = document.createElement('div');
                pieceElement.className = 'stash-piece black';
                pieceElement.textContent = '?';
                slot.appendChild(pieceElement);
            } else {
                // Check if there's a piece in this stash slot
                const piece = sampleGameState.stashes[row][col];
                if (piece) {
                    const pieceElement = document.createElement('div');
                    pieceElement.className = `stash-piece ${piece.color === 0 ? 'white' : 'black'}`;
                    pieceElement.textContent = PIECE_IDENTITIES[piece.identity];
                    slot.appendChild(pieceElement);
                }
            }
            
            stash.appendChild(slot);
        }
    }
}

// Update captured pieces display
function updateCapturedPieces() {
    const leftCaptured = document.getElementById('leftCaptures');
    const rightCaptured = document.getElementById('rightCaptures');
    
    // Clear existing
    leftCaptured.innerHTML = '';
    rightCaptured.innerHTML = '';
    
    // Add white captured pieces
    sampleGameState.captured[0].forEach(piece => {
        const pieceElement = document.createElement('div');
        pieceElement.className = 'captured-piece';
        pieceElement.textContent = PIECE_IDENTITIES[piece.identity];
        leftCaptured.appendChild(pieceElement);
    });
    
    // Add black captured pieces
    sampleGameState.captured[1].forEach(piece => {
        const pieceElement = document.createElement('div');
        pieceElement.className = 'captured-piece black';
        pieceElement.textContent = PIECE_IDENTITIES[piece.identity];
        rightCaptured.appendChild(pieceElement);
    });
}

// Update dagger counts
function updateDaggers() {
    const leftDaggerSpace = document.getElementById('leftDaggerSpace');
    const rightDaggerSpace = document.getElementById('rightDaggerSpace');
    
    // Clear existing dagger tokens
    leftDaggerSpace.innerHTML = '';
    rightDaggerSpace.innerHTML = '';
    
    // Create dagger tokens for left player (white)
    for (let i = 0; i < sampleGameState.daggers[0]; i++) {
        const daggerToken = document.createElement('div');
        daggerToken.className = 'dagger-token';
        daggerToken.textContent = '⚔';
        leftDaggerSpace.appendChild(daggerToken);
    }
    
    // Create dagger tokens for right player (black)
    for (let i = 0; i < sampleGameState.daggers[1]; i++) {
        const daggerToken = document.createElement('div');
        daggerToken.className = 'dagger-token';
        daggerToken.textContent = '⚔';
        rightDaggerSpace.appendChild(daggerToken);
    }
}

// Main initialization function
function initializeGame() {
    // Calculate sizes
    const playAreaSize = calculatePlayAreaSize();
    playAreaWidth = playAreaSize.width;
    playAreaHeight = playAreaSize.height;
    
    squareSize = calculateSquareSize();
    
    // Update font sizes based on new play area dimensions
    updateFontSizes();
    
    // Debug information
    console.log('Page dimensions:', window.innerWidth, 'x', window.innerHeight);
    console.log('Play area dimensions:', playAreaWidth, 'x', playAreaHeight);
    console.log('Square size:', squareSize);
    console.log('Board dimensions:', BOARD_COLS * squareSize, 'x', BOARD_ROWS * squareSize);
    
    // Position all elements
    positionElements();
    
    // Generate game elements
    generateBoard();
    generateStash();
    updateCapturedPieces();
    updateDaggers();
}

// Handle window resize
function handleResize() {
    initializeGame();
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initializeGame);

// Handle window resize
window.addEventListener('resize', handleResize);
