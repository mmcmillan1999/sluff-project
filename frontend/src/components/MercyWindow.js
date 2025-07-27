import React, { useState, useEffect } from 'react';
import './MercyWindow.css';

const MercyWindow = ({ show, onClose, emitEvent }) => {
    const [secondsLeft, setSecondsLeft] = useState(15);
    const [contemplationStartTime, setContemplationStartTime] = useState(null);

    useEffect(() => {
        if (show) {
            setSecondsLeft(15);
            setContemplationStartTime(Date.now()); // Record when contemplation started

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
        // Send contemplation start time for server-side validation
        emitEvent("requestFreeToken", { contemplationStartTime });
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
                <p className="rate-limit-notice">
                    <small>Note: Mercy tokens are limited to one per hour to encourage thoughtful play.</small>
                </p>
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