// frontend/src/components/FeedbackModal.js
import React, { useState, useEffect } from 'react';
import './FeedbackModal.css';

const FeedbackModal = ({ show, onClose, onSubmit, gameContext }) => {
    const [feedbackText, setFeedbackText] = useState('');
    const [includeGameState, setIncludeGameState] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Reset the modal's state whenever it is closed and re-opened.
    useEffect(() => {
        if (show) {
            setFeedbackText('');
            setIncludeGameState(true);
            setIsSubmitting(false);
            setError('');
            setSuccessMessage('');
        }
    }, [show]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!feedbackText.trim()) {
            setError('Feedback text cannot be empty.');
            return;
        }

        setIsSubmitting(true);
        setError('');
        setSuccessMessage('');

        const dataToSubmit = {
            feedback_text: feedbackText.trim(),
        };

        if (gameContext && includeGameState) {
            dataToSubmit.game_state_json = gameContext;
        }

        try {
            await onSubmit(dataToSubmit);
            setSuccessMessage('Thank you! Your feedback has been submitted successfully.');
        } catch (err) {
            setError(err.message || 'An unknown error occurred. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!show) {
        return null;
    }

    return (
        <div className="feedback-modal-overlay">
            <div className="feedback-modal-content">
                {successMessage ? (
                    <div className="feedback-modal-result">
                        <h3>Success!</h3>
                        <p>{successMessage}</p>
                        <button onClick={onClose} className="feedback-modal-button primary">Close</button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <h3>Submit Feedback</h3>
                        <p className="feedback-modal-subtitle">
                            Found a bug or have a suggestion? Let us know!
                        </p>
                        <textarea
                            className="feedback-modal-textarea"
                            placeholder="Please be as detailed as possible..."
                            value={feedbackText}
                            onChange={(e) => setFeedbackText(e.target.value)}
                            disabled={isSubmitting}
                            rows="6"
                        />

                        {gameContext && (
                            <div className="feedback-modal-checkbox-container">
                                <input
                                    type="checkbox"
                                    id="include-gamestate-checkbox"
                                    checked={includeGameState}
                                    onChange={(e) => setIncludeGameState(e.target.checked)}
                                    disabled={isSubmitting}
                                />
                                <label htmlFor="include-gamestate-checkbox">
                                    Include details about the current game state, such as player progress and settings, in this report (this helps with debugging).
                                </label>
                            </div>
                        )}

                        {error && <p className="feedback-modal-error">{error}</p>}

                        <div className="feedback-modal-actions">
                            <button
                                type="button"
                                onClick={onClose}
                                className="feedback-modal-button secondary"
                                disabled={isSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="feedback-modal-button primary"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Submitting...' : 'Submit'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default FeedbackModal;