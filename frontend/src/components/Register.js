// frontend/src/components/Register.js
import React, { useState } from 'react';
import './AuthForm.css';
import { register } from '../services/api';

const Register = ({ onRegisterSuccess, onSwitchToLogin }) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        try {
            const data = await register(username, email, password);
            setSuccessMessage(data.message);
        } catch (err) {
            if (err && err.message) {
                setError(err.message);
            } else {
                setError('An unexpected error occurred. Please try again.');
            }
        }
    };

    if (successMessage) {
        return (
            <div className="auth-container">
                <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
                <div className="auth-form" style={{ textAlign: 'center' }}>
                    <h3>✅ Registration Complete!</h3>
                    <p>{successMessage}</p>
                    {/* This button now correctly uses the onSwitchToLogin prop */}
                    <button onClick={onSwitchToLogin} className="auth-button login">Back to Login</button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-container">
            <img src="/SluffLogo.png" alt="Sluff Logo" className="auth-logo" />
            <h2 className="auth-title">Register</h2>
            <form onSubmit={handleSubmit} className="auth-form">
                <input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="auth-input"
                />
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
                <button type="submit" className="auth-button register">Register</button>
            </form>
            {/* This button now correctly uses the onSwitchToLogin prop */}
            <button onClick={onSwitchToLogin} className="switch-form-button">
                Already have an account? Login
            </button>
        </div>
    );
};

export default Register;