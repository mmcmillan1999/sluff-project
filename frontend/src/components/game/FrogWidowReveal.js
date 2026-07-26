// frontend/src/components/game/FrogWidowReveal.js
// Frog widow exchange as table art: the three widow cards fly out of the
// widow pile to the middle of the felt, sit face-up while the bidder picks
// their discards, then fly back into the pile when the exchange ends.
// Replaces the old ActionControls prompt-card "pop up" for this state.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import './FrogWidowReveal.css';

export const FROG_WIDOW_RETURN_MS = 550;

const FrogWidowReveal = ({ active, cards, renderCard }) => {
    const [shownCards, setShownCards] = useState(null);
    const [leaving, setLeaving] = useState(false);
    const rootRef = useRef(null);
    const leaveTimerRef = useRef(null);

    useEffect(() => {
        if (active && Array.isArray(cards) && cards.length > 0) {
            if (leaveTimerRef.current) {
                clearTimeout(leaveTimerRef.current);
                leaveTimerRef.current = null;
            }
            setShownCards(cards);
            setLeaving(false);
            return;
        }
        if (shownCards && !leaving) {
            // Exchange over: fly the cards back into the pile, then unmount.
            setLeaving(true);
            leaveTimerRef.current = setTimeout(() => {
                leaveTimerRef.current = null;
                setShownCards(null);
                setLeaving(false);
            }, FROG_WIDOW_RETURN_MS);
        }
    }, [active, cards, shownCards, leaving]);

    useEffect(() => () => {
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    }, []);

    // Measure the table: first push the card row clear of the docked action
    // prompt (portrait phones can wrap its text right into the felt center),
    // then measure the widow pile so the flight starts (and ends) on it.
    useLayoutEffect(() => {
        if (!shownCards || leaving) return;
        const root = rootRef.current;
        if (!root) return;
        let rootRect = root.getBoundingClientRect();
        if (rootRect.width === 0 && rootRect.height === 0) return;

        const prompt = document.querySelector('.action-prompt-container');
        if (prompt) {
            const promptRect = prompt.getBoundingClientRect();
            const clearance = (promptRect.bottom + 12) - rootRect.top;
            root.style.setProperty('--frog-shift-y', `${Math.max(0, clearance)}px`);
            // Re-measure after the shift so the flight origin stays exact.
            rootRect = root.getBoundingClientRect();
        }

        const pile = document.querySelector('[data-deal-target="widow"]');
        if (!pile) return;
        const pileRect = pile.getBoundingClientRect();
        const fromX = (pileRect.left + pileRect.width / 2) - (rootRect.left + rootRect.width / 2);
        const fromY = (pileRect.top + pileRect.height / 2) - (rootRect.top + rootRect.height / 2);
        root.style.setProperty('--frog-from-x', `${fromX}px`);
        root.style.setProperty('--frog-from-y', `${fromY}px`);
    }, [shownCards, leaving]);

    if (!shownCards) return null;

    return (
        <div
            ref={rootRef}
            className={`frog-widow-reveal${leaving ? ' is-returning' : ''}`}
            data-testid="frog-widow-reveal"
            aria-hidden="true"
        >
            {shownCards.map((card, index) => (
                <div
                    key={`${card}-${index}`}
                    className="frog-widow-reveal__card"
                    style={{ '--frog-delay': `${index * 110}ms` }}
                >
                    {renderCard(card, { large: true })}
                </div>
            ))}
        </div>
    );
};

export default FrogWidowReveal;
