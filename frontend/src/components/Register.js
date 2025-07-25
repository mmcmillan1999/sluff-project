// frontend/src/components/Register.js

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './AuthForm.css';
import { register } from '../services/api';

const Register = () => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMessage('');

        try {
            const data = await register(username, email, password);
            setSuccessMessage(data.message);
        } catch (err) {
            // --- THIS IS THE FINAL ROBUST ERROR HANDLING ---
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('An unexpected network error occurred. Please try again.');
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
                    <button onClick={() => navigate('/')} className="auth-button login">Back to Login</button>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-container">
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

                <div className="register-warning">
                    <strong className="register-warning-title">WARNING: Unrecoverable Password!</strong>
                    <p className="register-warning-text">There is currently no way to recover a lost password. Please store your password in a very safe place, like a password manager.</p>
                </div>

                {error && <p className="auth-error">{error}</p>}
                <button type="submit" className="auth-button register">Register</button>
            </form>
            <Link to="/" className="switch-form-button">
                Already have an account? Login
            </Link>
        </div>
    );
};

export default Register;