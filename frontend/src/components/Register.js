import React, { useState } from 'react';
import './AuthForm.css'; // Import the shared CSS file
import { register } from '../services/api'; // --- MODIFICATION: Import the new register service function ---

const Register = ({ onRegisterSuccess, onSwitchToLogin }) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        try {
            // --- MODIFICATION: Replace the old fetch with a call to the api service ---
            await register(username, email, password);
            onRegisterSuccess();
        } catch (err) {
            setError(err.message);
        }
    };

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
            <button onClick={onSwitchToLogin} className="switch-form-button">
                Already have an account? Login
            </button>
        </div>
    );
};

export default Register;