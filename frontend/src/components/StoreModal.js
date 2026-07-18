// frontend/src/components/StoreModal.js
// The Sluff store: cosmetic categories (deck skins, trump-broken effects).
// Everything is free and instantly equippable during alpha; the "FREE"
// price chip is where token prices and ownership gates land later.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DECK_SKINS, TRUMP_BROKEN_FX, setCosmetic, useCosmetics } from '../utils/cosmetics';
import { useModalFocus } from '../hooks/useModalFocus';
import McMillanCrest from './game/McMillanCrest';
import './StoreModal.css';

const DeckPreview = ({ skinId }) => (
    <div className={`store-deck-preview card-back-container deck-skin--${skinId}`} aria-hidden="true">
        {skinId === 'mcmillan'
            ? <McMillanCrest className="card-back-crest" />
            : <img src="/SluffLogo.png" alt="" className="card-back-image" />}
    </div>
);

// Static miniature of each trump-broken banner; tapping it replays the
// entrance so players can preview the effect before equipping.
const FxPreview = ({ fxId, playKey }) => (
    <div
        key={playKey}
        className={`store-fx-preview store-fx-preview--${fxId}`}
        aria-hidden="true"
    >
        {fxId === 'lightning' ? (
            <span className="store-fx-mini">⚡ TRUMP BROKEN! ⚡</span>
        ) : (
            <span className="store-fx-mini">✦ TRUMP BROKEN! ✦</span>
        )}
    </div>
);

const StoreItem = ({ name, description, preview, equipped, onUse, onPreview }) => (
    <div className={`store-item ${equipped ? 'is-equipped' : ''}`}>
        <button
            type="button"
            className="store-item-preview"
            onClick={onPreview || onUse}
            aria-label={onPreview ? `Preview ${name}` : `Equip ${name}`}
        >
            {preview}
        </button>
        <div className="store-item-info">
            <strong>{name}</strong>
            <p>{description}</p>
        </div>
        <div className="store-item-actions">
            <span className="store-price-chip">FREE</span>
            <button
                type="button"
                className="store-use-button"
                onClick={onUse}
                disabled={equipped}
            >
                {equipped ? 'Equipped ✓' : 'Use'}
            </button>
        </div>
    </div>
);

const StoreModal = ({ show, onClose }) => {
    const cosmetics = useCosmetics();
    const [fxPlayKeys, setFxPlayKeys] = useState({});
    const dialogRef = useModalFocus(show, '.store-close');

    useEffect(() => {
        if (!show) return undefined;
        const closeOnEscape = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [show, onClose]);

    if (!show) return null;

    const replayFx = (fxId) => {
        setFxPlayKeys(keys => ({ ...keys, [fxId]: (keys[fxId] || 0) + 1 }));
    };

    return createPortal(
        <div
            className="store-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                className="store-dialog"
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Sluff store"
                tabIndex="-1"
            >
                <button
                    type="button"
                    className="store-close"
                    onClick={onClose}
                    aria-label="Close store"
                >
                    ×
                </button>

                <header className="store-header">
                    <span className="store-awning" aria-hidden="true" />
                    <div>
                        <p className="store-kicker">Sluff Store</p>
                        <h2>Table Style</h2>
                        <p className="store-note">Alpha shelves — everything is free while we stock up.</p>
                    </div>
                </header>

                <section className="store-category" aria-label="Card decks">
                    <div className="store-category-heading">
                        <span>Card Decks</span>
                        <em>Changes every face-down card at your table</em>
                    </div>
                    <div className="store-items">
                        {DECK_SKINS.map(skin => (
                            <StoreItem
                                key={skin.id}
                                name={skin.name}
                                description={skin.description}
                                preview={<DeckPreview skinId={skin.id} />}
                                equipped={cosmetics.deckSkin === skin.id}
                                onUse={() => setCosmetic('deckSkin', skin.id)}
                            />
                        ))}
                    </div>
                </section>

                <section className="store-category" aria-label="Trump broken effects">
                    <div className="store-category-heading">
                        <span>Trump Broken</span>
                        <em>Tap a banner to replay its entrance</em>
                    </div>
                    <div className="store-items">
                        {TRUMP_BROKEN_FX.map(fx => (
                            <StoreItem
                                key={fx.id}
                                name={fx.name}
                                description={fx.description}
                                preview={<FxPreview fxId={fx.id} playKey={fxPlayKeys[fx.id] || 0} />}
                                equipped={cosmetics.trumpBrokenFx === fx.id}
                                onUse={() => setCosmetic('trumpBrokenFx', fx.id)}
                                onPreview={() => replayFx(fx.id)}
                            />
                        ))}
                    </div>
                </section>
            </section>
        </div>,
        document.body,
    );
};

export default StoreModal;
