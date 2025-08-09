// frontend/src/services/api.js

/**
 * Centralized API service module.
 * Handles all HTTP communication with the backend, providing a clean interface for components.
 */

// Smart environment detection - no more manual changes needed!
const getServerUrl = () => {
    // Check if we have an explicit override in env
    if (process.env.REACT_APP_SERVER_URL) {
        console.log(`[API] Using override from .env: ${process.env.REACT_APP_SERVER_URL}`);
        return process.env.REACT_APP_SERVER_URL;
    }
    
    // Detect based on where the frontend is running
    const hostname = window.location.hostname;
    
    // Local development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        // For local dev, always use local backend
        return 'http://localhost:3005';
    }
    
    // Production domains
    if (hostname === 'playsluff.com' || hostname === 'www.playsluff.com') {
        return 'https://sluff-backend.onrender.com';
    }
    
    // Netlify Stage deployment
    if (hostname === 'sluff-pilot.netlify.app') {
        return 'https://sluff-backend-pilot.onrender.com';
    }
    
    // Netlify Production deployment  
    if (hostname === 'sluff.netlify.app') {
        return 'https://sluff-backend.onrender.com';
    }
    
    // Generic Netlify branch deploys - use stage backend
    if (hostname.includes('netlify')) {
        return 'https://sluff-backend-pilot.onrender.com';
    }
    
    // Render.com deployment (if frontend is on Render)
    if (hostname.includes('onrender.com')) {
        return 'https://sluff-backend.onrender.com';
    }
    
    // Vercel deployments (if you use Vercel)
    if (hostname.includes('vercel.app')) {
        return 'https://sluff-backend-pilot.onrender.com';
    }
    
    // GitHub Pages
    if (hostname.includes('github.io')) {
        return 'https://sluff-backend.onrender.com';
    }
    
    // Default to stage backend for any unknown domains
    return 'https://sluff-backend-pilot.onrender.com';
};

const SERVER_URL = getServerUrl();

// Log the detected environment (helpful for debugging)
console.log(`[API] Auto-detected environment:`, {
    hostname: window.location.hostname,
    api: SERVER_URL,
    timestamp: new Date().toISOString()
});

// Optional: Test the connection on load (for development)
if (window.location.hostname === 'localhost') {
    fetch(`${SERVER_URL}/api/ping`)
        .then(res => res.json())
        .then(data => console.log('[API] Backend connection test:', data))
        .catch(err => console.warn('[API] Backend not responding locally:', err.message));
}

/**
 * A generic, configured fetch request helper.
 * @param {string} endpoint - The API endpoint to hit (e.g., '/api/auth/login').
 * @param {string} method - The HTTP method (e.g., 'POST', 'GET').
 * @param {object} [body=null] - The request body for POST/PUT requests.
 * @param {boolean} [requiresAuth=true] - Whether the request requires an Authorization token.
 * @returns {Promise<Response>} The raw fetch response object.
 */
const configuredFetch = async (endpoint, method, body = null, requiresAuth = true) => {
    const headers = { 'Content-Type': 'application/json' };
    
    if (requiresAuth) {
        const token = localStorage.getItem("sluff_token");
        if (!token) {
            throw new Error("Authentication token not found.");
        }
        headers['Authorization'] = `Bearer ${token}`;
    }

    const config = {
        method: method,
        headers: headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    return fetch(`${SERVER_URL}${endpoint}`, config);
};


// --- Auth Service Calls ---

export const login = async (email, password) => {
    const response = await configuredFetch('/api/auth/login', 'POST', { email, password }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to login');
    }
    return data;
};

export const register = async (username, email, password) => {
    try {
        const response = await configuredFetch('/api/auth/register', 'POST', { username, email, password }, false);
        const data = await response.json();
        if (!response.ok) {
            // This now correctly throws an error with the API's message
            throw new Error(data.message || 'Failed to register');
        }
        return data; // Return the success data
    } catch (error) {
        // This catches network errors (like "Failed to fetch") and re-throws them
        // so the component can display a generic message.
        throw error;
    }
};

export const verifyEmail = async (token) => {
    // This endpoint does not require an auth token, as the user is not yet logged in.
    const response = await configuredFetch('/api/auth/verify-email', 'POST', { token }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to verify email.');
    }
    return data;
};

export const requestPasswordReset = async (email) => {
    const response = await configuredFetch('/api/auth/request-password-reset', 'POST', { email }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to request password reset.');
    }
    return data;
};

export const resetPassword = async (token, password) => {
    const response = await configuredFetch('/api/auth/reset-password', 'POST', { token, password }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to reset password.');
    }
    return data;
};


// --- Leaderboard Service Calls ---

export const getLeaderboard = async () => {
    const response = await configuredFetch('/api/leaderboard', 'GET');
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch leaderboard data.');
    }
    return data;
};

// --- Admin Service Calls ---

export const generateSchema = async () => {
    const response = await configuredFetch('/api/admin/generate-schema', 'POST');
    const responseText = await response.text();
    if (!response.ok) {
        throw new Error(responseText);
    }
    return responseText;
};

// --- Lobby Chat Service Calls ---

export const getLobbyChatHistory = async (limit = 50) => {
    const response = await configuredFetch(`/api/chat?limit=${limit}`, 'GET');
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch chat history.');
    }
    return data;
};

export const sendLobbyChatMessage = async (message) => {
    const response = await configuredFetch('/api/chat', 'POST', { message });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to send chat message.');
    }
    return data;
};

// --- Feedback Service Calls ---

export const submitFeedback = async (feedbackData) => {
    const response = await configuredFetch('/api/feedback', 'POST', feedbackData);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to submit feedback.');
    }
    return data;
};

export const getFeedback = async () => {
    const response = await configuredFetch('/api/feedback', 'GET');
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to fetch feedback.');
    }
    return data;
};

export const updateFeedback = async (id, updateData) => {
    const response = await configuredFetch(`/api/feedback/${id}`, 'PUT', updateData);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to update feedback.');
    }
    return data;
};

export const resendVerificationEmail = async (email) => {
    const response = await configuredFetch('/api/auth/resend-verification', 'POST', { email }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to resend verification email.');
    }
    return data;
};