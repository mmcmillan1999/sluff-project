// frontend/src/components/game/ScoreProgressBar.js
import React from 'react';
import './LearnerDisplay.css';

const ScoreProgressBar = ({ currentPoints, opponentPoints, team }) => {
    const goalPoints = 60;
    const maxPossible = 120 - opponentPoints;
    const progressPercent = Math.min((currentPoints / goalPoints) * 100, 100);

    const barColor = team === 'bidder' 
        ? "linear-gradient(to right, #f59e0b, #facc15)" 
        : "linear-gradient(to right, #3b82f6, #60a5fa)";

    return (
        <div className={`score-progress-container team-${team}`}>
            {/* The label div has been removed from here */}
            <div className="score-progress-label">
                <strong>{currentPoints}</strong> of <strong>{goalPoints}</strong> Goal | <strong>{maxPossible}</strong> Max
            </div>
            <div className="score-progress-bar-background">
                <div 
                    className="score-progress-bar-foreground"
                    style={{ 
                        width: `${progressPercent}%`,
                        background: barColor 
                    }}
                >
                </div>
            </div>
        </div>
    );
};

export default ScoreProgressBar;