// frontend/src/services/api.js

/**
 * Centralized API service module.
 * Handles all HTTP communication with the backend, providing a clean interface for components.
 */

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3005";
console.log('API Service - Using SERVER_URL:', SERVER_URL);

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

    const url = `${SERVER_URL}${endpoint}`;
    console.log('Fetching:', url, 'with config:', config);
    return fetch(url, config);
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