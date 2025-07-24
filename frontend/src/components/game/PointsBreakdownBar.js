// frontend/src/components/game/PointsBreakdownBar.js
import React from 'react';
import './PointsBreakdownBar.css';

const PointsBreakdownBar = ({ bidderName, bidderPoints, defenderNames, defenderPoints }) => {
    const totalPoints = 120;
    const bidderWidth = (bidderPoints / totalPoints) * 100;

    return (
        <div className="points-breakdown-container">
            <div className="points-bar">
                {/* The visual "break even" line is handled by the ::after pseudo-element in CSS */}
                <div className="points-bar-bidder" style={{ width: `${bidderWidth}%` }}>
                    <div className="player-info">
                        <span className="player-name">{bidderName}</span>
                        <span className="player-points">{bidderPoints} pts</span>
                    </div>
                </div>
                <div className="points-bar-defender">
                    <div className="player-info">
                        <span className="player-name">{defenderNames.join(', ')}</span>
                        <span className="player-points">{defenderPoints} pts</span>
                    </div>
                </div>
            </div>
            <div className="break-even-label">Break Even Line</div>
        </div>
    );
};

export default PointsBreakdownBar;