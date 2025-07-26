// frontend/src/components/VerifyEmail.js
import React, { useState, useEffect } from 'react';
import { verifyEmail } from '../services/api';
import './AuthForm.css';

const VerifyEmail = ({ onNavigate }) => {
    const [verificationStatus, setVerificationStatus] = useState('verifying');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        // --- THE FIX: Use vanilla JS to get the token from the URL ---
        const token = new URLSearchParams(window.location.search).get('token');

        if (!token) {
            setVerificationStatus('error');
            setErrorMessage('No verification token found. Please check your link.');
            return;
        }

        const processVerification = async () => {
            try {
                await verifyEmail(token);
                setVerificationStatus('success');
            } catch (err) {
                setVerificationStatus('error');
                setErrorMessage(err.message || 'An unknown error occurred.');
            }
        };

        processVerification();
    }, []);

    const renderContent = () => {
        switch (verificationStatus) {
            case 'verifying':
                return <h3>Verifying your account...</h3>;
            case 'success':
                return (
                    <>
                        <h3>✅ Email Verified Successfully!</h3>
                        <p>Your account is now active. You can now log in to the game.</p>
                        {/* --- THE FIX: Use a button with the onNavigate prop --- */}
                        <button onClick={() => onNavigate('login')} className="auth-button login">
                            Go to Login
                        </button>
                    </>
                );
            case 'error':
                return (
                    <>
                        <h3>❌ Verification Failed</h3>
                        <p className="auth-error">{errorMessage}</p>
                        {/* --- THE FIX: Use a button with the onNavigate prop --- */}
                        <button onClick={() => onNavigate('login')} className="auth-button login">
                            Back to Login
                        </button>
                    </>
                );
            default:
                return null;
        }
    };

    return (
        <div className="auth-container">
             <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
            <div className="auth-form" style={{textAlign: 'center'}}>
                {renderContent()}
            </div>
        </div>
    );
};

export default VerifyEmail;