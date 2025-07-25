// frontend/src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login.js';
import Register from './components/Register.js';
import VerifyEmail from './components/VerifyEmail.js';
import MainApp from './MainApp.js';

// A wrapper component to protect routes that require authentication
const PrivateRoute = ({ children }) => {
    const token = localStorage.getItem("sluff_token");
    return token ? children : <Navigate to="/" />;
};

// A wrapper component for login/register pages to redirect if already logged in
const PublicRoute = ({ children }) => {
    const token = localStorage.getItem("sluff_token");
    return token ? <Navigate to="/app" /> : children;
};

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<PublicRoute><Login /></PublicRoute>} />
                <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
                <Route path="/verify-email" element={<VerifyEmail />} />
                <Route 
                    path="/app" 
                    element={
                        <PrivateRoute>
                            <MainApp />
                        </PrivateRoute>
                    } 
                />
                {/* Redirect any other path to the appropriate starting point */}
                <Route path="*" element={<Navigate to={localStorage.getItem("sluff_token") ? "/app" : "/"} />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;