// frontend/src/utils/safetyHelpers.js

/**
 * Safely get a nested property from an object
 * @param {Object} obj - The object to traverse
 * @param {string} path - Dot-separated path (e.g., 'user.profile.name')
 * @param {*} defaultValue - Default value if path doesn't exist
 * @returns {*} The value at the path or the default value
 */
export const safeGet = (obj, path, defaultValue = null) => {
    if (!obj || typeof obj !== 'object') return defaultValue;
    
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
        if (current === null || current === undefined || !(key in current)) {
            return defaultValue;
        }
        current = current[key];
    }
    
    return current;
};

/**
 * Safely get array length
 * @param {Array} arr - The array to check
 * @returns {number} The length of the array or 0 if not an array
 */
export const safeArrayLength = (arr) => {
    return Array.isArray(arr) ? arr.length : 0;
};

/**
 * Safely filter an array
 * @param {Array} arr - The array to filter
 * @param {Function} predicate - The filter function
 * @returns {Array} Filtered array or empty array if input is not an array
 */
export const safeFilter = (arr, predicate) => {
    return Array.isArray(arr) ? arr.filter(predicate) : [];
};

/**
 * Safely map an array
 * @param {Array} arr - The array to map
 * @param {Function} mapper - The map function
 * @returns {Array} Mapped array or empty array if input is not an array
 */
export const safeMap = (arr, mapper) => {
    return Array.isArray(arr) ? arr.map(mapper) : [];
};

/**
 * Safely access object values
 * @param {Object} obj - The object to get values from
 * @returns {Array} Array of values or empty array if not an object
 */
export const safeObjectValues = (obj) => {
    return obj && typeof obj === 'object' ? Object.values(obj) : [];
};

/**
 * Safely access object keys
 * @param {Object} obj - The object to get keys from
 * @returns {Array} Array of keys or empty array if not an object
 */
export const safeObjectKeys = (obj) => {
    return obj && typeof obj === 'object' ? Object.keys(obj) : [];
};

/**
 * Check if a value is null or undefined
 * @param {*} value - The value to check
 * @returns {boolean} True if null or undefined
 */
export const isNullOrUndefined = (value) => {
    return value === null || value === undefined;
};

/**
 * Get a safe string representation
 * @param {*} value - The value to convert to string
 * @param {string} defaultValue - Default string if value is null/undefined
 * @returns {string} String representation or default
 */
export const safeString = (value, defaultValue = '') => {
    if (isNullOrUndefined(value)) return defaultValue;
    return String(value);
};

/**
 * Get a safe number representation
 * @param {*} value - The value to convert to number
 * @param {number} defaultValue - Default number if value is invalid
 * @returns {number} Number representation or default
 */
export const safeNumber = (value, defaultValue = 0) => {
    if (isNullOrUndefined(value)) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
};