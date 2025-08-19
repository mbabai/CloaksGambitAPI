import React, { useState } from 'react';
import PlayArea from './PlayArea';
import './PlayAreaDemo.module.css';

const PlayAreaDemo = () => {
  const [borderColor, setBorderColor] = useState('#DAA520');
  const [backgroundColor, setBackgroundColor] = useState('#800080');
  const [aspectRatio, setAspectRatio] = useState(1.618);
  const [containerSizes, setContainerSizes] = useState({
    fixed: { width: 800, height: 400 },
    responsive: { width: '100%', height: 300 },
    square: { width: 500, height: 500 }
  });

  const handleResize = (key) => (dimensions) => {
    console.log(`${key} PlayArea resized:`, dimensions);
  };

  const resizeFixedContainer = () => {
    const newWidth = Math.random() * 400 + 400; // Random between 400-800
    const newHeight = Math.random() * 300 + 200; // Random between 200-500
    setContainerSizes(prev => ({
      ...prev,
      fixed: { width: newWidth, height: newHeight }
    }));
  };

  const resizeResponsiveContainer = () => {
    const newHeight = Math.random() * 200 + 200; // Random between 200-400
    setContainerSizes(prev => ({
      ...prev,
      responsive: { ...prev.responsive, height: newHeight }
    }));
  };

  return (
    <div className="demo-container">
      <h1>PlayArea Component Demo</h1>
      <p>This demo shows the React PlayArea component that maintains a golden ratio (1.618) and dynamically sizes itself to fit its parent container.</p>
      
      <div className="demo-section">
        <div className="demo-title">Fixed Size Container ({containerSizes.fixed.width}x{containerSizes.fixed.height})</div>
        <div 
          className="parent-container"
          style={{ 
            width: `${containerSizes.fixed.width}px`, 
            height: `${containerSizes.fixed.height}px` 
          }}
        >
          <PlayArea
            aspectRatio={aspectRatio}
            borderColor={borderColor}
            backgroundColor={backgroundColor}
            onResize={handleResize('fixed')}
          >
            <div className="content-placeholder">
              Fixed Container PlayArea
            </div>
          </PlayArea>
        </div>
      </div>
      
      <div className="demo-section">
        <div className="demo-title">Responsive Container (100% width, {containerSizes.responsive.height}px height)</div>
        <div 
          className="parent-container"
          style={{ 
            width: '100%', 
            height: `${containerSizes.responsive.height}px` 
          }}
        >
          <PlayArea
            aspectRatio={aspectRatio}
            borderColor={borderColor}
            backgroundColor={backgroundColor}
            onResize={handleResize('responsive')}
          >
            <div className="content-placeholder">
              Responsive Container PlayArea
            </div>
          </PlayArea>
        </div>
      </div>
      
      <div className="demo-section">
        <div className="demo-title">Square Container (500x500)</div>
        <div 
          className="parent-container"
          style={{ width: 500, height: 500 }}
        >
          <PlayArea
            aspectRatio={aspectRatio}
            borderColor={borderColor}
            backgroundColor={backgroundColor}
            onResize={handleResize('square')}
          >
            <div className="content-placeholder">
              Square Container PlayArea
            </div>
          </PlayArea>
        </div>
      </div>
      
      <div className="controls">
        <div className="demo-title">Controls</div>
        
        <div className="control-group">
          <label>Border Color:</label>
          <input 
            type="color" 
            value={borderColor}
            onChange={(e) => setBorderColor(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <label>Background Color:</label>
          <input 
            type="color" 
            value={backgroundColor}
            onChange={(e) => setBackgroundColor(e.target.value)}
          />
        </div>
        
        <div className="control-group">
          <label>Aspect Ratio:</label>
          <select 
            value={aspectRatio}
            onChange={(e) => setAspectRatio(parseFloat(e.target.value))}
          >
            <option value={1.618}>Golden Ratio (1.618)</option>
            <option value={1.5}>3:2 Ratio (1.5)</option>
            <option value={1.333}>4:3 Ratio (1.333)</option>
            <option value={2.0}>2:1 Ratio (2.0)</option>
          </select>
        </div>
        
        <div className="control-group">
          <button onClick={resizeFixedContainer}>Resize Fixed Container</button>
          <button onClick={resizeResponsiveContainer}>Resize Responsive Container</button>
        </div>
      </div>
      
      <div className="info">
        <strong>How it works:</strong> The PlayArea component automatically calculates the optimal size to fit within its parent while maintaining the specified aspect ratio. 
        If the parent is wider than the target ratio, it fills the vertical space. If the parent is taller, it fills the horizontal space. 
        The component is always centered within its parent.
      </div>
    </div>
  );
};

export default PlayAreaDemo;
