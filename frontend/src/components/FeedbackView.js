// frontend/src/components/FeedbackView.js
import React, { useState, useEffect, useCallback } from 'react';
import { getFeedback, updateFeedback } from '../services/api';
import './FeedbackView.css';

const FeedbackView = ({ user, onReturnToLobby }) => {
    const [feedbackItems, setFeedbackItems] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [editingItemId, setEditingItemId] = useState(null);
    const [editFormData, setEditFormData] = useState({ admin_response: '', admin_notes: '' });

    const fetchFeedback = useCallback(async () => {
        setIsLoading(true);
        setError('');
        try {
            const data = await getFeedback();
            setFeedbackItems(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchFeedback();
    }, [fetchFeedback]);

    const handleUpdateStatus = async (id, newStatus) => {
        try {
            const updatedItem = await updateFeedback(id, { status: newStatus });
            setFeedbackItems(prevItems =>
                prevItems.map(item => (item.feedback_id === id ? updatedItem : item))
            );
        } catch (err) {
            alert(`Error updating status: ${err.message}`);
        }
    };

    const handleEditClick = (item) => {
        setEditingItemId(item.feedback_id);
        setEditFormData({
            admin_response: item.admin_response || '',
            admin_notes: item.admin_notes || ''
        });
    };

    const handleCancelEdit = () => {
        setEditingItemId(null);
    };

    const handleSaveEdit = async (id) => {
        try {
            const updatedItem = await updateFeedback(id, editFormData);
            setFeedbackItems(prevItems =>
                prevItems.map(item => (item.feedback_id === id ? updatedItem : item))
            );
            setEditingItemId(null);
        } catch (err) {
            alert(`Error saving changes: ${err.message}`);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setEditFormData(prev => ({ ...prev, [name]: value }));
    };

    const formatTimestamp = (ts) => {
        if (!ts) return 'N/A';
        return new Date(ts).toLocaleString();
    };

    const renderFeedbackItem = (item) => {
        const isEditing = editingItemId === item.feedback_id;

        return (
            <div key={item.feedback_id} className={`feedback-card status-${item.status}`}>
                <div className="feedback-card-header">
                    <span className="feedback-username">{item.username}</span>
                    <span className="feedback-timestamp">{formatTimestamp(item.submitted_at)}</span>
                    <span className={`feedback-status status-${item.status}`}>{item.status.replace('_', ' ')}</span>
                </div>
                <p className="feedback-text">{item.feedback_text}</p>
                
                {item.admin_response && !isEditing && (
                    <div className="admin-response-section">
                        <h4>Admin Response:</h4>
                        <p>{item.admin_response}</p>
                    </div>
                )}

                {user.is_admin && !isEditing && (
                    <>
                        {item.admin_notes && (
                            <div className="admin-notes-section">
                                <h5>Admin Notes:</h5>
                                <pre>{item.admin_notes}</pre>
                            </div>
                        )}
                        <div className="admin-controls">
                            <button onClick={() => handleEditClick(item)} className="admin-btn edit">Respond/Edit</button>
                            <select onChange={(e) => handleUpdateStatus(item.feedback_id, e.target.value)} value={item.status} className="admin-select">
                                <option value="new">New</option>
                                <option value="in_progress">In Progress</option>
                                <option value="resolved">Resolved</option>
                                <option value="wont_fix">Won't Fix</option>
                                <option value="hidden">Hidden</option>
                            </select>
                        </div>
                    </>
                )}

                {isEditing && (
                    <div className="admin-edit-form">
                        <label>Response (Visible to user)</label>
                        <textarea name="admin_response" value={editFormData.admin_response} onChange={handleInputChange} rows="3" />
                        
                        <label>Admin Notes (Admin only)</label>
                        <textarea name="admin_notes" value={editFormData.admin_notes} onChange={handleInputChange} rows="3" />
                        
                        <div className="edit-form-actions">
                            <button onClick={handleCancelEdit} className="admin-btn secondary">Cancel</button>
                            <button onClick={() => handleSaveEdit(item.feedback_id)} className="admin-btn primary">Save</button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="feedback-view">
            <header className="feedback-header">
                <h2>Feedback Repository</h2>
                <button onClick={onReturnToLobby} className="back-button">Back to Lobby</button>
            </header>
            <main className="feedback-main">
                {isLoading ? (
                    <p>Loading feedback...</p>
                ) : error ? (
                    <p className="error-text">Error: {error}</p>
                ) : (
                    <div className="feedback-list">
                        {feedbackItems.length > 0 ? feedbackItems.map(renderFeedbackItem) : <p>No feedback has been submitted yet.</p>}
                    </div>
                )}
            </main>
        </div>
    );
};

export default FeedbackView;