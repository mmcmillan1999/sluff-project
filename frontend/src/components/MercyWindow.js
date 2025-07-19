import React, { useState, useEffect } from 'react';
import './MercyWindow.css';

const MercyWindow = ({ show, onClose, emitEvent }) => {
    const [secondsLeft, setSecondsLeft] = useState(15);

    useEffect(() => {
        if (show) {
            setSecondsLeft(15);

            const timer = setInterval(() => {
                setSecondsLeft(prevSeconds => {
                    if (prevSeconds <= 1) {
                        clearInterval(timer);
                        return 0;
                    }
                    return prevSeconds - 1;
                });
            }, 1000);

            return () => clearInterval(timer);
        }
    }, [show]);

    const handleRedeem = () => {
        // --- MODIFICATION: Only emit the request for the token. ---
        // The server is now responsible for pushing the user update.
        emitEvent("requestFreeToken");
        onClose();
    };

    if (!show) {
        return null;
    }

    const isButtonDisabled = secondsLeft > 0;

    return (
        <div className="mercy-window-overlay">
            <div className="mercy-window-content">
                <h2>A Moment of Contemplation</h2>
                <p>You have lost everything. Contemplate your life choices for the next few moments before receiving a handout.</p>
                <div className="timer-display">
                    {secondsLeft}
                </div>
                <button
                    onClick={handleRedeem}
                    className={`redemption-button ${isButtonDisabled ? 'disabled' : 'enabled'}`}
                    disabled={isButtonDisabled}
                >
                    I'm sorry, I'm bad
                </button>
            </div>
        </div>
    );
};

export default MercyWindow;