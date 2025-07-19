import React from 'react';

/**
 * A generic progress bar for displaying point accumulation.
 */
const ScoreProgressBar = ({ currentPoints, opponentPoints, barColor }) => {
    const goalPoints = 60;
    const maxPossible = 120 - opponentPoints;
    const progressPercent = Math.min((currentPoints / goalPoints) * 100, 100);

    return (
        <div className="score-progress-container">
            {/* --- MODIFICATION: Updated the label format --- */}
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