// frontend/src/services/api.js

/**
 * Centralized API service module.
 * Handles all HTTP communication with the backend, providing a clean interface for components.
 */

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "https://sluff-backend.onrender.com";

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
    const response = await configuredFetch('/api/auth/register', 'POST', { username, email, password }, false);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to register');
    }
    return;
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

// --- NEW: Feedback Service Calls ---

export const submitFeedback = async (feedbackData) => {
    // The configuredFetch helper handles authentication by default.
    const response = await configuredFetch('/api/feedback', 'POST', feedbackData);
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || 'Failed to submit feedback.');
    }
    return data; // Returns the success message from the server, e.g., { message: '...' }
};