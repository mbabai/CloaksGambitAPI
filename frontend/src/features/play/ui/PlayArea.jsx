import React, { useEffect, useRef, useState, useCallback } from 'react';
import './PlayArea.module.css';

const PlayArea = ({ 
  children, 
  aspectRatio = 1.618, // Golden ratio
  borderColor = '#DAA520', // Golden border
  backgroundColor = '#800080', // Purple background
  className = '',
  style = {},
  onResize = null,
  ...props 
}) => {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, left: 0, top: 0 });
  const [resizeObserver, setResizeObserver] = useState(null);

  const updateSize = useCallback(() => {
    if (!containerRef.current) return;

    const parentRect = containerRef.current.getBoundingClientRect();
    const parentWidth = parentRect.width;
    const parentHeight = parentRect.height;
    
    const parentRatio = parentHeight / parentWidth;
    const targetRatio = aspectRatio;
    
    let finalWidth, finalHeight;
    
    if (parentRatio < targetRatio) {
      // Parent is wider than target ratio - fill vertical space
      finalHeight = parentHeight;
      finalWidth = parentHeight / targetRatio;
    } else {
      // Parent is taller than target ratio - fill horizontal space
      finalWidth = parentWidth;
      finalHeight = parentWidth * targetRatio;
    }
    
    // Center the play area within the parent
    const left = (parentWidth - finalWidth) / 2;
    const top = (parentHeight - finalHeight) / 2;
    
    const newDimensions = {
      width: finalWidth,
      height: finalHeight,
      left: left,
      top: top
    };
    
    setDimensions(newDimensions);
    
    // Call onResize callback if provided
    if (onResize) {
      onResize(newDimensions);
    }
  }, [aspectRatio, onResize]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Use ResizeObserver to watch for parent size changes
    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(containerRef.current);
      setResizeObserver(observer);
    } else {
      // Fallback for older browsers
      const handleResize = () => {
        updateSize();
      };
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [updateSize]);

  useEffect(() => {
    // Initial size calculation
    updateSize();
  }, [updateSize]);

  useEffect(() => {
    // Cleanup ResizeObserver on unmount
    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [resizeObserver]);

  const playAreaStyle = {
    position: 'absolute',
    width: `${dimensions.width}px`,
    height: `${dimensions.height}px`,
    left: `${dimensions.left}px`,
    top: `${dimensions.top}px`,
    border: `3px solid ${borderColor}`,
    backgroundColor: backgroundColor,
    boxSizing: 'border-box',
    transition: 'all 0.1s ease-out',
    ...style
  };

  return (
    <div 
      ref={containerRef} 
      className={`play-area-container ${className}`}
      style={{ position: 'relative' }}
      {...props}
    >
      <div 
        className="play-area"
        style={playAreaStyle}
      >
        {children}
      </div>
    </div>
  );
};

export default PlayArea;
