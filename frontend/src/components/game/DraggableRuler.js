// frontend/src/components/game/DraggableRuler.js
import React, { useState, useEffect } from 'react';
import './DraggableRuler.css';

const DraggableRuler = () => {
    const [position, setPosition] = useState({ x: 100, y: 200 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [rulerWidth, setRulerWidth] = useState(0);

    useEffect(() => {
        const updateRulerWidth = () => {
            const vw200 = window.innerWidth / 200;
            setRulerWidth(vw200);
        };

        updateRulerWidth();
        window.addEventListener('resize', updateRulerWidth);
        return () => window.removeEventListener('resize', updateRulerWidth);
    }, []);

    const handleMouseDown = (e) => {
        setIsDragging(true);
        setDragOffset({
            x: e.clientX - position.x,
            y: e.clientY - position.y
        });
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            setPosition({
                x: e.clientX - dragOffset.x,
                y: e.clientY - dragOffset.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, dragOffset]);

    return (
        <div 
            className="draggable-ruler"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
                width: `${rulerWidth}px`
            }}
            onMouseDown={handleMouseDown}
        >
            <div className="ruler-bar" style={{ width: `${rulerWidth}px` }}></div>
            <div className="ruler-label">
                vw/200 = {rulerWidth.toFixed(2)}px
            </div>
            <div className="ruler-end-marker left">|</div>
            <div className="ruler-end-marker right">|</div>
        </div>
    );
};

export default DraggableRuler;