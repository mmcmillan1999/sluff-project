// frontend/src/components/AuthContainer.js
import React, { useState, useEffect } from 'react';
import Login from './Login.js';
import Register from './Register.js';
import VerifyEmail from './VerifyEmail.js';
import RequestPasswordReset from './RequestPasswordReset.js';
import ResetPassword from './ResetPassword.js';

const AuthContainer = ({ onLoginSuccess }) => {
    const [view, setView] = useState('login');

    useEffect(() => {
        const path = window.location.pathname;
        const token = new URLSearchParams(window.location.search).get('token');
        
        if (path === '/verify-email') {
            setView('verify');
        }
        if (path === '/reset-password' && token) {
            setView('reset');
        }
    }, []);

    const handleNavigate = (newView) => {
        const url = newView === 'login' ? '/' : `/${newView}`;
        // We use pushState to change the URL for user clarity, but the view state is what controls rendering.
        window.history.pushState({}, '', url);
        setView(newView);
    };

    switch (view) {
        case 'register':
            return <Register onRegisterSuccess={() => handleNavigate('login')} onSwitchToLogin={() => handleNavigate('login')} />;
        case 'verify':
            return <VerifyEmail onNavigate={handleNavigate} />;
        case 'forgot':
            return <RequestPasswordReset onNavigate={handleNavigate} />;
        case 'reset':
            return <ResetPassword onNavigate={handleNavigate} />;
        case 'login':
        default:
            return <Login 
                onLoginSuccess={onLoginSuccess} 
                onSwitchToRegister={() => handleNavigate('register')} 
                onSwitchToForgotPassword={() => handleNavigate('forgot')} 
            />;
    }
};

export default AuthContainer;