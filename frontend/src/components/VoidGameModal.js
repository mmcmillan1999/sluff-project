import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../hooks/useModalFocus';
import './VoidGameModal.css';

const VoidGameModal = ({
    gameId,
    show,
    isSubmitting = false,
    error = '',
    onClose,
    onConfirm,
}) => {
    const dialogRef = useModalFocus(show, '.void-game-cancel');

    useEffect(() => {
        if (!show) return undefined;
        const closeOnEscape = event => {
            if (event.key === 'Escape' && !isSubmitting) onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [isSubmitting, onClose, show]);

    if (!show) return null;

    return createPortal(
        <div
            className="void-game-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget && !isSubmitting) onClose();
            }}
        >
            <section
                className="void-game-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="void-game-title"
                aria-describedby="void-game-oath void-game-explanation"
                aria-busy={isSubmitting}
                tabIndex="-1"
            >
                <div className="void-game-seal" aria-hidden="true">♠</div>
                <p className="void-game-kicker">The honor system</p>
                <h2 id="void-game-title">Scout’s honor?</h2>
                <p id="void-game-oath" className="void-game-oath">
                    I do solemnly swear that Game #{gameId} should not count.
                </p>
                <p id="void-game-explanation" className="void-game-explanation">
                    Every buy-in will be returned, every payout will be taken back, and the
                    season and lifetime result will be removed for everyone. This cannot be undone.
                </p>

                {error && <p className="void-game-error" role="alert">{error}</p>}

                <div className="void-game-actions">
                    <button
                        type="button"
                        className="void-game-cancel"
                        onClick={onClose}
                        disabled={isSubmitting}
                    >
                        Keep the game
                    </button>
                    <button
                        type="button"
                        className="void-game-confirm"
                        onClick={onConfirm}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Voiding game…' : 'Scout’s honor — void it.'}
                    </button>
                </div>
            </section>
        </div>,
        document.body,
    );
};

export default VoidGameModal;
