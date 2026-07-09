/**
 * utils.js
 * Frontend Shared Foundation
 * Standardizes API communication, error handling, and utilities.
 */

/**
 * Shared API Wrapper
 * Supports automatic JWT injection and strict HTTP error propagation.
 */
async function apiRequest(url, options = {}) {
    const token = typeof getToken === 'function' ? getToken() : null;
    const headers = {
        'Content-Type': 'application/json',
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const config = { ...options, headers: { ...headers, ...(options.headers || {}) } };
    
    try {
        const response = await fetch(url, config);
        
        let data;
        if (response.status === 204) {
            return null; // No content
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            try {
                data = await response.json();
            } catch (err) {
                // Handle malformed JSON
                data = { error: 'Invalid JSON response from server' };
            }
        } else {
            // Handle cases where the backend might crash or return plain text
            data = { error: await response.text() };
        }

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                if (typeof clearAuth === 'function') {
                    clearAuth();
                }
                window.location.href = '/';
            }
            
            // Custom Error preserving status code and backend messages
            const error = new Error(data.error || data.message || `HTTP Error ${response.status}`);
            error.status = response.status;
            error.details = data.details || null;
            throw error;
        }
        
        return data;
    } catch (error) {
        console.error(`API Error for ${url}:`, error);
        
        // Handle network failures (TypeError from fetch)
        if (error instanceof TypeError) {
            const networkError = new Error("Network failure or connection timeout.");
            networkError.status = 0; // 0 typically denotes network issue
            throw networkError;
        }
        
        // Re-throw preserved HTTP errors for specific UI handling
        throw error;
    }
}

/**
 * Shared HTML Escaping Utility
 * Prevents XSS when rendering raw backend strings into the DOM.
 */
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Shared Application Constants
 * Prevents hardcoded magic strings across modules.
 */
const AppConstants = {
    Roles: {
        ADMIN: 'Admin',
        STUDENT: 'Student'
    },
    TaskStatuses: {
        PENDING: 'PENDING',
        APPROVED: 'APPROVED',
        REJECTED: 'REJECTED',
        REQUIRES_MANUAL_AUDIT: 'REQUIRES_MANUAL_AUDIT'
    },
    Platforms: {
        YOUTUBE: 'youtube',
        INSTAGRAM: 'instagram',
        FACEBOOK: 'facebook',
        LINKEDIN: 'linkedin'
    }
};
