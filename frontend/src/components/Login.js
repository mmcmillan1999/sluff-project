import React, { useState } from 'react';
import './AuthForm.css'; // Import the shared CSS file
import { login } from '../services/api'; // --- MODIFICATION: Import the new login service function ---

const Login = ({ onLoginSuccess, onSwitchToRegister }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        try {
            // --- MODIFICATION: Replace the old fetch with a call to the api service ---
            const data = await login(email, password);
            onLoginSuccess(data);
        } catch (err) {
            setError(err.message);
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
                <button type="submit" className="auth-button login">Login</button>
            </form>
            <button onClick={onSwitchToRegister} className="switch-form-button">
                Don't have an account? Register
            </button>
        </div>
    );
};

export default Login;