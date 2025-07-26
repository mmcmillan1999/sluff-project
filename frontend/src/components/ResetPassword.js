// frontend/src/components/ResetPassword.js
import React, { useState } from 'react';
import './AuthForm.css';
import { resetPassword } from '../services/api';

const ResetPassword = ({ onNavigate }) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const token = new URLSearchParams(window.location.search).get('token');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        if (!token) {
            setError("No reset token found. Please request a new reset link.");
            return;
        }
        setError('');
        setSuccessMessage('');

        try {
            const data = await resetPassword(token, password);
            setSuccessMessage(data.message);
        } catch (err) {
            setError(err.message || 'An unexpected error occurred.');
        }
    };

    if (successMessage) {
        return (
            <div className="auth-container">
                <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
                <div className="auth-form" style={{ textAlign: 'center' }}>
                    <h3>✅ Success!</h3>
                    <p>{successMessage}</p>
                    <button onClick={() => onNavigate('login')} className="auth-button login">Proceed to Login</button>
                </div>
            </div>
        );
    }
    
    return (
        <div className="auth-container">
            <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
            <h2 className="auth-title">Reset Your Password</h2>
            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="password"
                    placeholder="New Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="auth-input"
                />
                <input
                    type="password"
                    placeholder="Confirm New Password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="auth-input"
                />
                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="auth-button login">Reset Password</button>
            </form>
        </div>
    );
};

export default ResetPassword;