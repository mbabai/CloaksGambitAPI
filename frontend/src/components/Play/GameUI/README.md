# PlayArea Component

A React component that maintains a specified aspect ratio and dynamically sizes itself to fit its parent container while always being centered.

## Features

- **Dynamic Sizing**: Automatically calculates optimal dimensions to fit within parent
- **Aspect Ratio Maintenance**: Always maintains the specified aspect ratio (default: golden ratio 1.618)
- **Responsive**: Uses ResizeObserver for efficient size change detection
- **Centered Positioning**: Always centers the play area within its parent
- **Customizable**: Configurable border color, background color, and aspect ratio
- **Event Callbacks**: Provides resize events for integration with other components

## Usage

### Basic Usage

```jsx
import PlayArea from './PlayArea';

function GameContainer() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <PlayArea
        aspectRatio={1.618}
        borderColor="#DAA520"
        backgroundColor="#800080"
      >
        {/* Your game content goes here */}
        <div>Game Board</div>
      </PlayArea>
    </div>
  );
}
```

### With Resize Callback

```jsx
function GameContainer() {
  const handleResize = (dimensions) => {
    console.log('PlayArea resized:', dimensions);
    // Update other game elements based on new dimensions
    updateGameLayout(dimensions);
  };

  return (
    <PlayArea
      onResize={handleResize}
      aspectRatio={1.618}
    >
      <GameBoard />
    </PlayArea>
  );
}
```

### Custom Styling

```jsx
<PlayArea
  aspectRatio={1.618}
  borderColor="#FF0000"
  backgroundColor="#00FF00"
  style={{
    borderRadius: '10px',
    boxShadow: '0 4px 8px rgba(0,0,0,0.3)'
  }}
  className="custom-play-area"
>
  <GameContent />
</PlayArea>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | ReactNode | - | Content to render inside the play area |
| `aspectRatio` | number | 1.618 | Target aspect ratio (height/width) |
| `borderColor` | string | '#DAA520' | Color of the border |
| `backgroundColor` | string | '#800080' | Background color |
| `className` | string | '' | Additional CSS class names |
| `style` | object | {} | Additional inline styles |
| `onResize` | function | null | Callback when dimensions change |

## How It Works

1. **Size Calculation**: The component calculates the optimal size based on the parent container's dimensions and the target aspect ratio
2. **Filling Strategy**: 
   - If parent is wider than target ratio → fills vertical space
   - If parent is taller than target ratio → fills horizontal space
3. **Centering**: The play area is always centered within its parent container
4. **Responsive Updates**: Uses ResizeObserver to automatically update when the parent size changes

## Integration with Existing Code

The PlayArea component is designed to work alongside your existing `usePlayAreaLayout` hook. You can:

1. **Gradually migrate** from the hook-based approach to the component-based approach
2. **Use both** - the hook for existing logic, PlayArea for new features
3. **Replace entirely** - migrate all layout logic to use the PlayArea component

### Migration Example

**Before (using hook):**
```jsx
const { sizes, positions, cssVars } = usePlayAreaLayout(containerRef, {
  rows: BOARD_ROWS,
  cols: BOARD_COLS,
  stashRows: STASH_ROWS,
  stashCols: STASH_COLS
});
```

**After (using PlayArea):**
```jsx
<PlayArea
  aspectRatio={17/10} // Same as existing TARGET_RATIO
  onResize={(dimensions) => {
    // Calculate sizes based on new dimensions
    const sizes = calculateSizes(dimensions, {
      rows: BOARD_ROWS,
      cols: BOARD_COLS,
      stashRows: STASH_ROWS,
      stashCols: STASH_COLS
    });
    // Update game state
  }}
>
  <GameBoard />
</PlayArea>
```

## Examples

See the following files for complete examples:
- `PlayAreaDemo.jsx` - Interactive demo with controls
- `PlayAreaIntegration.jsx` - Integration examples with existing code

## Browser Support

- **Modern browsers**: Uses ResizeObserver for optimal performance
- **Older browsers**: Falls back to window resize events
- **React 16.8+**: Uses React hooks (useState, useEffect, useRef, useCallback)

## Performance

- **Efficient**: Only recalculates when parent size actually changes
- **Smooth**: Uses CSS transitions for visual updates
- **Memory-safe**: Properly cleans up ResizeObserver on unmount
- **Optimized**: Uses useCallback to prevent unnecessary re-renders
