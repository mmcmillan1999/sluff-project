import React, { useState, useEffect } from 'react';
import './MercyWindow.css';

const MercyWindow = ({ show, onClose, emitEvent, user }) => {
    const [secondsLeft, setSecondsLeft] = useState(15);
    const [contemplationStartTime, setContemplationStartTime] = useState(null);
    const isVIP = user?.is_vip || false;

    useEffect(() => {
        if (show) {
            setSecondsLeft(15);
            setContemplationStartTime(Date.now()); // Record when contemplation started

            // Only start timer for non-VIP users
            if (!isVIP) {
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
        }
    }, [show, isVIP]);

    const handleRedeem = () => {
        // Send contemplation start time for server-side validation
        emitEvent("requestFreeToken", { contemplationStartTime });
        onClose();
        
        // Auto-sync user after 3 seconds
        setTimeout(() => {
            emitEvent("requestUserSync");
        }, 3000);
    };

    const handleVIPRedeem = () => {
        // VIP users bypass the timer
        emitEvent("requestFreeToken", { contemplationStartTime: Date.now() - 16000, isVIP: true });
        onClose();
        
        // Auto-sync user after 3 seconds
        setTimeout(() => {
            emitEvent("requestUserSync");
        }, 3000);
    };

    if (!show) {
        return null;
    }

    const isButtonDisabled = !isVIP && secondsLeft > 0;

    return (
        <div className="mercy-window-overlay">
            <div className="mercy-window-content">
                <h2>A Moment of Contemplation</h2>
                <p>You have lost everything. Contemplate your life choices for the next few moments before receiving a handout.</p>
                <p className="rate-limit-notice">
                    <small>Note: Mercy tokens are limited to one per hour to encourage thoughtful play.</small>
                </p>
                {!isVIP && (
                    <div className="timer-display">
                        {secondsLeft}
                    </div>
                )}
                {isVIP && (
                    <div className="vip-badge">
                        ⭐ VIP Member ⭐
                    </div>
                )}
                <button
                    onClick={handleRedeem}
                    className={`redemption-button ${isButtonDisabled ? 'disabled' : 'enabled'}`}
                    disabled={isButtonDisabled}
                >
                    I'm sorry, I'm bad
                </button>
                {isVIP && (
                    <button
                        onClick={handleVIPRedeem}
                        className="vip-redemption-button"
                    >
                        VIP Instant Redeem
                    </button>
                )}
            </div>
        </div>
    );
};

export default MercyWindow;