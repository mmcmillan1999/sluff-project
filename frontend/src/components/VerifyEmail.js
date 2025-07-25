// frontend/src/components/VerifyEmail.js

import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { verifyEmail } from '../services/api';
import './AuthForm.css'; // We can reuse the auth form styles for consistency

const VerifyEmail = () => {
    const [searchParams] = useSearchParams();
    const [verificationStatus, setVerificationStatus] = useState('verifying'); // 'verifying', 'success', 'error'
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        const token = searchParams.get('token');

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
    }, [searchParams]);

    const renderContent = () => {
        switch (verificationStatus) {
            case 'verifying':
                return <h3>Verifying your account...</h3>;
            case 'success':
                return (
                    <>
                        <h3>✅ Email Verified Successfully!</h3>
                        <p>Your account is now active. You can now log in to the game.</p>
                        <Link to="/" className="auth-button login" style={{ textDecoration: 'none', textAlign: 'center' }}>
                            Go to Login
                        </Link>
                    </>
                );
            case 'error':
                return (
                    <>
                        <h3>❌ Verification Failed</h3>
                        <p className="auth-error">{errorMessage}</p>
                        <p>Please try registering again or contact support if the problem persists.</p>
                         <Link to="/" className="auth-button login" style={{ textDecoration: 'none', textAlign: 'center' }}>
                            Back to Login
                        </Link>
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