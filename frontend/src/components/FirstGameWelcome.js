import React, { useState } from 'react';
import useModalFocus from '../hooks/useModalFocus';
import { TUTORIAL_BUY_IN_LABEL, TUTORIAL_VERSION } from '../config/tutorial';
import './FirstGameWelcome.css';

export { TUTORIAL_VERSION };

const numericField = value => {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
};

export const shouldShowFirstGameWelcome = ({
    user,
    isLobby,
    hasCurrentTable,
    hasPendingInvite,
    socketSessionReady,
}) => {
    const tutorialVersion = numericField(user?.tutorial_version);
    const activeVersion = numericField(user?.tutorial_active_version);

    return Boolean(
        user
        && isLobby
        && !hasCurrentTable
        && !hasPendingInvite
        && socketSessionReady
        && tutorialVersion !== null
        && tutorialVersion < TUTORIAL_VERSION
        && activeVersion !== null
    );
};

const FirstGameWelcome = ({ activeVersion = 0, onStartGuided, onSkip }) => {
    const [pendingAction, setPendingAction] = useState(null);
    const [error, setError] = useState('');
    const dialogRef = useModalFocus(true, '[data-tutorial-primary]');
    const isContinuing = Number(activeVersion) === TUTORIAL_VERSION;

    const runAction = async (action, callback) => {
        if (pendingAction) return;
        setPendingAction(action);
        setError('');
        try {
            await callback();
            setPendingAction(null);
        } catch (actionError) {
            setError(actionError?.message || 'Could not save your choice. Please try again.');
            setPendingAction(null);
        }
    };

    return (
        <div className="first-game-welcome" data-testid="first-game-welcome-backdrop">
            <section
                ref={dialogRef}
                className="first-game-welcome__card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="first-game-welcome-title"
                aria-describedby="first-game-welcome-description first-game-welcome-buy-in"
                aria-busy={pendingAction ? 'true' : 'false'}
                tabIndex={-1}
            >
                <div className="first-game-welcome__eyebrow">Guided Academy game</div>
                <h1 id="first-game-welcome-title">
                    {isContinuing ? 'Continue learning Sluff' : 'Learn Sluff at the Academy'}
                </h1>
                <p id="first-game-welcome-description" className="first-game-welcome__intro">
                    {isContinuing
                        ? 'Your guided Academy game is ready whenever you are.'
                        : 'Learn the rhythm of bidding, tricks, and scoring with guidance at the table.'}
                </p>

                <div className="first-game-welcome__academy" aria-label="Miss Paul's Academy guided game">
                    <span className="first-game-welcome__crest" aria-hidden="true">A</span>
                    <div>
                        <strong>Miss Paul&apos;s Academy</strong>
                        <span>A real game with help along the way</span>
                    </div>
                </div>

                <p id="first-game-welcome-buy-in" className="first-game-welcome__buy-in">
                    <img src="/Sluff_Token_v2.webp" alt="" aria-hidden="true" />
                    <span><strong>{TUTORIAL_BUY_IN_LABEL} coin buy-in</strong> for the guided game</span>
                </p>

                {error && <p className="first-game-welcome__error" role="alert">{error}</p>}

                <div className="first-game-welcome__actions">
                    <button
                        type="button"
                        data-tutorial-primary
                        className="first-game-welcome__primary"
                        disabled={Boolean(pendingAction)}
                        onClick={() => runAction('start', onStartGuided)}
                    >
                        {pendingAction === 'start'
                            ? 'Opening the Academy…'
                            : isContinuing ? 'Continue Guided Game' : 'Play Guided Game'}
                    </button>
                    <button
                        type="button"
                        className="first-game-welcome__skip"
                        disabled={Boolean(pendingAction)}
                        onClick={() => runAction('skip', onSkip)}
                    >
                        {pendingAction === 'skip' ? 'Saving…' : 'I already know Sluff'}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default FirstGameWelcome;
