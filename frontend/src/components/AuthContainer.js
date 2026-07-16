// frontend/src/components/AuthContainer.js
import React, { useState, useEffect } from 'react';
import Login from './Login.js';
import Register from './Register.js';
import VerifyEmail from './VerifyEmail.js';
import RequestPasswordReset from './RequestPasswordReset.js';
import ResetPassword from './ResetPassword.js';
import ClaudeLanding from './ClaudeLanding.js';
import PrivacyPolicy from './legal/PrivacyPolicy.js';
import TermsOfService from './legal/TermsOfService.js';

const viewFromLocation = () => {
    const path = window.location.pathname;
    const token = new URLSearchParams(window.location.search).get('token');

    if (path === '/verify-email') return 'verify';
    if (path === '/reset-password' && token) return 'reset';
    if (path === '/register') return 'register';
    if (path === '/login') return 'login';
    if (path === '/forgot') return 'forgot';
    if (path === '/terms') return 'terms';
    if (path === '/privacy') return 'privacy';
    return 'landing';
};

const AuthContainer = ({ onLoginSuccess, inviteTableId }) => {
    const [view, setView] = useState(viewFromLocation);

    useEffect(() => {
        const handlePopState = () => setView(viewFromLocation());
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const handleNavigate = (newView) => {
        const encodedInvite = inviteTableId ? encodeURIComponent(inviteTableId) : null;
        const inviteQuery = encodedInvite ? `?join=${encodedInvite}` : '';
        const url = newView === 'landing'
            ? (encodedInvite ? `/join/${encodedInvite}` : '/')
            : `/${newView}${inviteQuery}`;

        window.history.pushState({}, '', url);
        setView(newView);
    };

    const renderView = () => {
        switch (view) {
            case 'register':
                return <Register
                    onRegisterSuccess={() => handleNavigate('login')}
                    onSwitchToLogin={() => handleNavigate('login')}
                    onShowTerms={() => handleNavigate('terms')}
                    onShowPrivacy={() => handleNavigate('privacy')}
                />;
            case 'terms':
                return <TermsOfService onNavigate={handleNavigate} />;
            case 'privacy':
                return <PrivacyPolicy onNavigate={handleNavigate} />;
            case 'verify':
                return <VerifyEmail onNavigate={handleNavigate} />;
            case 'forgot':
                return <RequestPasswordReset onNavigate={handleNavigate} />;
            case 'reset':
                return <ResetPassword onNavigate={handleNavigate} />;
            case 'landing':
                return <ClaudeLanding
                    inviteTableId={inviteTableId}
                    onRegister={() => handleNavigate('register')}
                    onLogin={() => handleNavigate('login')}
                    onNavigate={handleNavigate}
                />;
            case 'login':
            default:
                return <Login
                    onLoginSuccess={onLoginSuccess}
                    onSwitchToRegister={() => handleNavigate('register')}
                    onSwitchToForgotPassword={() => handleNavigate('forgot')}
                />;
        }
    };

    return (
        <>
            {inviteTableId && (view === 'login' || view === 'register') && (
                <div className="auth-invite-banner" role="status">
                    A friend invited you to their table. Sign in or create an account and you will be seated automatically.
                </div>
            )}
            {renderView()}
        </>
    );
};

export default AuthContainer;
