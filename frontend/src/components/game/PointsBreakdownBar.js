// frontend/src/components/game/PointsBreakdownBar.js
import React from 'react';
import './PointsBreakdownBar.css';

const PointsBreakdownBar = ({ bidderPoints, defenderPoints }) => {
    const totalPoints = 120;
    const minWidthPercent = 15;
    
    const bidderWidthPercent = (bidderPoints / totalPoints) * 100;
    const defenderWidthPercent = (defenderPoints / totalPoints) * 100;

    const bidderDisplayWidth = Math.max(bidderWidthPercent, (bidderPoints > 0 ? minWidthPercent : 0));
    const defenderDisplayWidth = Math.max(defenderWidthPercent, (defenderPoints > 0 ? minWidthPercent : 0));

    return (
        <div className="points-breakdown-container">
            <div className="points-bar">
                <div className="points-bar-bidder" style={{ width: `${bidderDisplayWidth}%` }}>
                    <div className="player-info">
                        <span className="player-points">{bidderPoints} pts</span>
                    </div>
                </div>
                <div className="points-bar-defender" style={{ width: `${defenderDisplayWidth}%` }}>
                    <div className="player-info">
                        <span className="player-points">{defenderPoints} pts</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PointsBreakdownBar;