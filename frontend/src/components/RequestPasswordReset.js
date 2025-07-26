// frontend/src/components/RequestPasswordReset.js
import React, { useState } from 'react';
import './AuthForm.css';
import { requestPasswordReset } from '../services/api';

const RequestPasswordReset = ({ onNavigate }) => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');
        try {
            const data = await requestPasswordReset(email);
            setSuccessMessage(data.message);
        } catch (err) {
            setError(err.message || 'An unexpected error occurred.');
        }
    };

    return (
        <div className="auth-container">
            <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
            <h2 className="auth-title">Forgot Password</h2>
            {successMessage ? (
                <div className="auth-form" style={{ textAlign: 'center' }}>
                    <h3>✅ Request Sent</h3>
                    <p>{successMessage}</p>
                    <button onClick={() => onNavigate('login')} className="auth-button login">Back to Login</button>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="auth-form">
                    <p style={{ textAlign: 'center', margin: '0 0 10px 0' }}>Enter your email address and we will send you a link to reset your password.</p>
                    <input
                        type="email"
                        placeholder="Email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="auth-input"
                    />
                    {error && <p className="auth-error">{error}</p>}
                    <button type="submit" className="auth-button login">Send Reset Link</button>
                </form>
            )}
            <button onClick={() => onNavigate('login')} className="switch-form-button">Back to Login</button>
        </div>
    );
};

export default RequestPasswordReset;