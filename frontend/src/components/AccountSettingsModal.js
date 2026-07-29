// frontend/src/components/AccountSettingsModal.js
// Account self-service: change your name (once a week) and delete your account.
// In-app deletion is required by App Store guideline 5.1.1(v) — pointing a
// player at a support email does not satisfy it.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { changeUsername, deleteAccount } from '../services/api';
import { useModalFocus } from '../hooks/useModalFocus';
import './AccountSettingsModal.css';

const USERNAME_MAX_LENGTH = 20;

const describeUnlock = (isoDate) => {
    const unlockMs = Date.parse(isoDate || '');
    if (!Number.isFinite(unlockMs)) return null;
    const remainingMs = unlockMs - Date.now();
    if (remainingMs <= 0) return null;

    // Always round up: telling someone "in 2 days" when 2 days and 23 hours
    // remain sends them back to a form that is still locked.
    if (remainingMs >= 86400000) {
        const days = Math.ceil(remainingMs / 86400000);
        return `in ${days} day${days === 1 ? '' : 's'}`;
    }
    if (remainingMs >= 3600000) {
        const hours = Math.ceil(remainingMs / 3600000);
        return `in ${hours} hour${hours === 1 ? '' : 's'}`;
    }
    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
};

const AccountSettingsModal = ({ show, user, onClose, onUsernameChanged, onAccountDeleted }) => {
    const [nextName, setNextName] = useState('');
    const [renameState, setRenameState] = useState({ busy: false, error: null, notice: null });
    const [unlockAt, setUnlockAt] = useState(null);

    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const [password, setPassword] = useState('');
    const [typedName, setTypedName] = useState('');
    const [deleteState, setDeleteState] = useState({ busy: false, error: null });

    const dialogRef = useModalFocus(show, '.account-close');

    // Reopening starts clean — a half-typed password must never persist.
    useEffect(() => {
        if (show) return;
        setNextName('');
        setRenameState({ busy: false, error: null, notice: null });
        setConfirmingDelete(false);
        setPassword('');
        setTypedName('');
        setDeleteState({ busy: false, error: null });
    }, [show]);

    useEffect(() => {
        setUnlockAt(user?.username_next_change_at || null);
    }, [user?.username_next_change_at, show]);

    useEffect(() => {
        if (!show) return undefined;
        const onKeyDown = (event) => {
            if (event.key === 'Escape' && !renameState.busy && !deleteState.busy) onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [show, onClose, renameState.busy, deleteState.busy]);

    const lockedUntil = useMemo(() => describeUnlock(unlockAt), [unlockAt]);
    const renameLocked = Boolean(lockedUntil);
    const deleteArmed = typedName.trim() === user?.username && password.length > 0;

    const submitRename = async (event) => {
        event.preventDefault();
        if (renameState.busy || renameLocked) return;
        setRenameState({ busy: true, error: null, notice: null });
        try {
            const result = await changeUsername(nextName);
            setUnlockAt(result.nextChangeAllowedAt);
            setNextName('');
            setRenameState({ busy: false, error: null, notice: `You're now ${result.username}.` });
            onUsernameChanged?.(result.username);
        } catch (error) {
            if (error.nextChangeAllowedAt) setUnlockAt(error.nextChangeAllowedAt);
            setRenameState({ busy: false, error: error.message, notice: null });
        }
    };

    const submitDelete = async (event) => {
        event.preventDefault();
        if (deleteState.busy || !deleteArmed) return;
        setDeleteState({ busy: true, error: null });
        try {
            await deleteAccount(password);
            onAccountDeleted?.();
        } catch (error) {
            setPassword('');
            setDeleteState({ busy: false, error: error.message });
        }
    };

    if (!show) return null;

    return createPortal(
        <div
            className="account-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget && !renameState.busy && !deleteState.busy) onClose();
            }}
        >
            <div className="account-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="account-title">
                <button type="button" className="account-close" onClick={onClose} aria-label="Close account settings">×</button>
                <h2 className="account-title" id="account-title">Account</h2>
                <p className="account-current">
                    Signed in as <strong>{user?.username}</strong>
                </p>

                <section className="account-section">
                    <h3 className="account-section-title">Change your username</h3>
                    <p className="account-hint">
                        You can change it once a week. Past games, chat, and season standings keep the
                        name you had at the time.
                    </p>

                    <form onSubmit={submitRename}>
                        <input
                            type="text"
                            className="account-input"
                            value={nextName}
                            onChange={(event) => setNextName(event.target.value)}
                            placeholder="New username"
                            maxLength={USERNAME_MAX_LENGTH}
                            autoComplete="off"
                            disabled={renameState.busy || renameLocked}
                            aria-label="New username"
                        />
                        <button
                            type="submit"
                            className="account-button account-button--primary"
                            disabled={renameState.busy || renameLocked || nextName.trim().length === 0}
                        >
                            {renameState.busy ? 'Saving…' : 'Save username'}
                        </button>
                    </form>

                    {renameLocked && (
                        <p className="account-status" role="status">
                            You changed it recently — you can change it again {lockedUntil}.
                        </p>
                    )}
                    {renameState.notice && (
                        <p className="account-status account-status--good" role="status">{renameState.notice}</p>
                    )}
                    {renameState.error && (
                        <p className="account-status account-status--bad" role="alert">{renameState.error}</p>
                    )}
                </section>

                <section className="account-section account-section--danger">
                    <h3 className="account-section-title">Delete your account</h3>
                    <p className="account-hint">
                        This is permanent. Your account, token balance, and game history are deleted and
                        cannot be restored. Messages you posted stay in the chat but are no longer linked
                        to you.
                    </p>

                    {!confirmingDelete ? (
                        <button
                            type="button"
                            className="account-button account-button--danger"
                            onClick={() => setConfirmingDelete(true)}
                        >
                            Delete my account
                        </button>
                    ) : (
                        <form onSubmit={submitDelete}>
                            <label className="account-label" htmlFor="account-confirm-name">
                                Type <strong>{user?.username}</strong> to confirm
                            </label>
                            <input
                                id="account-confirm-name"
                                type="text"
                                className="account-input"
                                value={typedName}
                                onChange={(event) => setTypedName(event.target.value)}
                                autoComplete="off"
                                disabled={deleteState.busy}
                            />
                            <label className="account-label" htmlFor="account-confirm-password">
                                Enter your password
                            </label>
                            <input
                                id="account-confirm-password"
                                type="password"
                                className="account-input"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                autoComplete="current-password"
                                disabled={deleteState.busy}
                            />
                            <div className="account-button-row">
                                <button
                                    type="button"
                                    className="account-button"
                                    onClick={() => {
                                        setConfirmingDelete(false);
                                        setPassword('');
                                        setTypedName('');
                                        setDeleteState({ busy: false, error: null });
                                    }}
                                    disabled={deleteState.busy}
                                >
                                    Keep my account
                                </button>
                                <button
                                    type="submit"
                                    className="account-button account-button--danger"
                                    disabled={deleteState.busy || !deleteArmed}
                                >
                                    {deleteState.busy ? 'Deleting…' : 'Permanently delete'}
                                </button>
                            </div>
                        </form>
                    )}

                    {deleteState.error && (
                        <p className="account-status account-status--bad" role="alert">{deleteState.error}</p>
                    )}
                </section>
            </div>
        </div>,
        document.body,
    );
};

export default AccountSettingsModal;
