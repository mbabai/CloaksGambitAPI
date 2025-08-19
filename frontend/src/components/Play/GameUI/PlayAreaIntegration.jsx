import React from 'react';
import PlayArea from './PlayArea';

// Example 1: Basic integration with existing GameUI
export const PlayAreaBasicIntegration = () => {
  const handleResize = (dimensions) => {
    console.log('PlayArea resized:', dimensions);
    // You can use these dimensions to update other game elements
    // For example, update CSS custom properties
    document.documentElement.style.setProperty('--play-area-width', `${dimensions.width}px`);
    document.documentElement.style.setProperty('--play-area-height', `${dimensions.height}px`);
  };

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <PlayArea
        aspectRatio={1.618}
        borderColor="#DAA520"
        backgroundColor="#800080"
        onResize={handleResize}
      >
        {/* Your game content goes here */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: 'white',
          fontSize: '24px'
        }}>
          Game Content Area
        </div>
      </PlayArea>
    </div>
  );
};

// Example 2: Integration with game layout
export const PlayAreaWithGameLayout = () => {
  const [gameState, setGameState] = React.useState({
    isGameActive: false,
    currentPlayer: 'white'
  });

  const handleResize = (dimensions) => {
    // Update game board and UI element positions based on play area size
    updateGameLayout(dimensions);
  };

  const updateGameLayout = (dimensions) => {
    // This would update your existing game layout
    console.log('Updating game layout for dimensions:', dimensions);
    
    // Example: Calculate board size based on play area
    const boardSize = Math.min(dimensions.width * 0.8, dimensions.height * 0.6);
    
    // Update CSS custom properties for other game elements
    document.documentElement.style.setProperty('--board-size', `${boardSize}px`);
    document.documentElement.style.setProperty('--play-area-width', `${dimensions.width}px`);
    document.documentElement.style.setProperty('--play-area-height', `${dimensions.height}px`);
  };

  const startGame = () => {
    setGameState(prev => ({ ...prev, isGameActive: true }));
  };

  const endGame = () => {
    setGameState(prev => ({ ...prev, isGameActive: false }));
  };

  const switchPlayer = () => {
    setGameState(prev => ({ 
      ...prev, 
      currentPlayer: prev.currentPlayer === 'white' ? 'black' : 'white' 
    }));
  };

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <PlayArea
        aspectRatio={1.618}
        borderColor={gameState.currentPlayer === 'white' ? '#FFFFFF' : '#000000'}
        backgroundColor={gameState.isGameActive ? '#006400' : '#800080'}
        onResize={handleResize}
      >
        <div style={{ 
          display: 'flex', 
          flexDirection: 'column',
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: 'white',
          gap: '20px'
        }}>
          <h2>Game Status: {gameState.isGameActive ? 'Active' : 'Inactive'}</h2>
          <p>Current Player: {gameState.currentPlayer}</p>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={startGame} disabled={gameState.isGameActive}>
              Start Game
            </button>
            <button onClick={endGame} disabled={!gameState.isGameActive}>
              End Game
            </button>
            <button onClick={switchPlayer} disabled={!gameState.isGameActive}>
              Switch Player
            </button>
          </div>
        </div>
      </PlayArea>
    </div>
  );
};

// Example 3: Integration with existing usePlayAreaLayout hook
export const PlayAreaWithExistingHook = () => {
  // This shows how you might integrate with the existing usePlayAreaLayout hook
  // You could potentially replace or enhance the existing hook with the PlayArea component
  
  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <PlayArea
        aspectRatio={17/10} // Match the existing TARGET_RATIO from usePlayAreaLayout
        borderColor="#DAA520"
        backgroundColor="#800080"
        onResize={(dimensions) => {
          // Here you could integrate with existing game logic
          console.log('PlayArea dimensions for integration:', dimensions);
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%',
          color: 'white',
          fontSize: '20px',
          textAlign: 'center'
        }}>
          <div>
            <h3>Integration with Existing Hook</h3>
            <p>This PlayArea uses the same aspect ratio (17:10) as the existing usePlayAreaLayout hook</p>
            <p>You can gradually migrate from the hook-based approach to this component-based approach</p>
          </div>
        </div>
      </PlayArea>
    </div>
  );
};

// Example 4: Advanced integration with game components
export const PlayAreaAdvancedIntegration = ({ children, gameConfig = {} }) => {
  const {
    aspectRatio = 1.618,
    borderColor = '#DAA520',
    backgroundColor = '#800080',
    showBorder = true,
    showBackground = true,
    onResize = null,
    className = '',
    style = {}
  } = gameConfig;

  const handleResize = (dimensions) => {
    // Call the provided onResize callback
    if (onResize) {
      onResize(dimensions);
    }
    
    // Additional integration logic
    updateGameComponents(dimensions);
  };

  const updateGameComponents = (dimensions) => {
    // Update various game components based on the new dimensions
    // This is where you'd integrate with your existing game logic
    
    // Example: Update board positioning
    const boardContainer = document.querySelector('.game-board');
    if (boardContainer) {
      const boardSize = Math.min(dimensions.width * 0.7, dimensions.height * 0.5);
      boardContainer.style.width = `${boardSize}px`;
      boardContainer.style.height = `${boardSize}px`;
    }
    
    // Example: Update stash positioning
    const stashContainer = document.querySelector('.game-stash');
    if (stashContainer) {
      stashContainer.style.top = `${dimensions.height * 0.6}px`;
    }
  };

  const playAreaStyle = {
    ...style,
    border: showBorder ? `3px solid ${borderColor}` : 'none',
    backgroundColor: showBackground ? backgroundColor : 'transparent'
  };

  return (
    <PlayArea
      aspectRatio={aspectRatio}
      borderColor={borderColor}
      backgroundColor={backgroundColor}
      onResize={handleResize}
      className={className}
      style={playAreaStyle}
    >
      {children}
    </PlayArea>
  );
};

export default PlayArea;
