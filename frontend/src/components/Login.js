// frontend/src/components/Login.js
import React, { useState } from 'react';
import './AuthForm.css';
import { login, resendVerificationEmail } from '../services/api';

const Login = ({ onLoginSuccess, onSwitchToRegister, onSwitchToForgotPassword }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showResendLink, setShowResendLink] = useState(false);
    const [resendStatus, setResendStatus] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setShowResendLink(false);
        setResendStatus('');

        try {
            const data = await login(email, password);
            onLoginSuccess(data); // Uses the prop to signal success
        } catch (err) {
            const errorMessage = (err && err.message) ? err.message : 'An unexpected error occurred. Please try again.';
            setError(errorMessage);

            if (errorMessage.includes("Account not verified")) {
                setShowResendLink(true);
            }
        }
    };

    const handleResend = async () => {
        setError('');
        setResendStatus('Sending...');
        try {
            const data = await resendVerificationEmail(email);
            setResendStatus(data.message);
            setShowResendLink(false);
        } catch (err) {
            setError(err.message || 'Failed to resend email.');
            setResendStatus('');
        }
    };

    return (
        <div className="auth-container">
            <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
            <h2 className="auth-title">Login</h2>
            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="auth-input"
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="auth-input"
                />
                
                {error && <p className="auth-error">{error}</p>}
                
                {showResendLink && (
                    <div style={{ textAlign: 'center', marginTop: '10px' }}>
                        <button type="button" onClick={handleResend} className="switch-form-button" style={{color: '#ffc107'}}>
                            Resend verification email
                        </button>
                    </div>
                )}
                {resendStatus && <p style={{color: '#28a745', textAlign: 'center'}}>{resendStatus}</p>}

                <button type="submit" className="auth-button login">Login</button>

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    {/* Uses the prop for navigation */}
                    <button type="button" onClick={onSwitchToForgotPassword} className="switch-form-button" style={{ fontSize: '0.9em', color: '#aaa' }}>
                        Forgot Password?
                    </button>
                </div>
            </form>
            {/* Uses the prop for navigation */}
            <button onClick={onSwitchToRegister} className="switch-form-button">
                Don't have an account? Register
            </button>
        </div>
    );
};

export default Login;