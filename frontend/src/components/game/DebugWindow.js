// frontend/src/components/game/DebugWindow.js
import React, { useState, useEffect } from 'react';
import './DebugWindow.css';

const DebugWindow = () => {
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    useEffect(() => {
        // Update viewport dimensions
        const updateViewport = () => {
            setViewport({
                width: window.innerWidth,
                height: window.innerHeight
            });
        };

        // Update mouse position
        const updateMousePosition = (e) => {
            setMousePos({
                x: e.clientX,
                y: e.clientY
            });
        };

        // Initial viewport size
        updateViewport();

        // Add event listeners
        window.addEventListener('resize', updateViewport);
        window.addEventListener('mousemove', updateMousePosition);

        // Cleanup
        return () => {
            window.removeEventListener('resize', updateViewport);
            window.removeEventListener('mousemove', updateMousePosition);
        };
    }, []);

    return (
        <div className="debug-window">
            <div className="debug-title">Debug Info</div>
            <div className="debug-info">
                <div className="debug-section">
                    <span className="debug-label">Viewport:</span>
                    <span className="debug-value">{viewport.width} x {viewport.height}</span>
                </div>
                <div className="debug-section">
                    <span className="debug-label">Mouse X:</span>
                    <span className="debug-value">{mousePos.x}</span>
                </div>
                <div className="debug-section">
                    <span className="debug-label">Mouse Y:</span>
                    <span className="debug-value">{mousePos.y}</span>
                </div>
                <div className="debug-section">
                    <span className="debug-label">VW/VH:</span>
                    <span className="debug-value">
                        {Math.round((mousePos.x / viewport.width) * 100)}vw, {Math.round((mousePos.y / viewport.height) * 100)}vh
                    </span>
                </div>
            </div>
        </div>
    );
};

export default DebugWindow;