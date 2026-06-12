// frontend/src/components/game/SuperBotModal.js
import React, { useState, useEffect } from 'react';
import './SuperBotModal.css';

const SuperBotModal = ({ emitEvent, onSelectModel, onClose }) => {
    const [selectedModel, setSelectedModel] = useState(null);
    const [models, setModels] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Use a static list of available models
        const availableModels = [
            { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', provider: 'OpenAI', speed: 'fast' },
            { id: 'gpt-5.5', name: 'GPT-5.5', provider: 'OpenAI', speed: 'medium' },
            { id: 'gpt-5.4-nano', name: 'GPT-5.4 Nano', provider: 'OpenAI', speed: 'very-fast' },
            { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', provider: 'Anthropic', speed: 'fast' },
            { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', provider: 'Anthropic', speed: 'medium' },
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'Google', speed: 'fast' },
            { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Google', speed: 'medium' },
            { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', provider: 'Groq', speed: 'fast' },
            { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', provider: 'Groq', speed: 'very-fast' }
        ];
        
        setModels(availableModels);
        setLoading(false);
    }, []);

    const handleSelect = () => {
        if (selectedModel) {
            onSelectModel(selectedModel);
        }
    };

    const getProviderColor = (provider) => {
        const colors = {
            'OpenAI': '#10a37f',
            'Anthropic': '#d97757',
            'Google': '#4285f4',
            'Groq': '#ff6b6b'
        };
        return colors[provider] || '#6c757d';
    };

    const getSpeedBadge = (speed) => {
        const badges = {
            'very-fast': { text: '⚡⚡⚡', color: '#00ff00' },
            'fast': { text: '⚡⚡', color: '#90ee90' },
            'medium': { text: '⚡', color: '#ffd700' }
        };
        return badges[speed] || badges['medium'];
    };

    return (
        <div className="superbot-modal-overlay" onClick={onClose}>
            <div className="superbot-modal" onClick={(e) => e.stopPropagation()}>
                <h2>Select AI Model</h2>
                
                {loading ? (
                    <div className="loading">Loading available models...</div>
                ) : models.length === 0 ? (
                    <div className="no-models">
                        <p>No AI models available</p>
                        <p className="hint">API keys may not be configured</p>
                    </div>
                ) : (
                    <>
                        <div className="models-grid">
                            {models.map((model) => {
                                const speedBadge = getSpeedBadge(model.speed);
                                return (
                                    <div
                                        key={model.id}
                                        className={`model-card ${selectedModel === model.id ? 'selected' : ''}`}
                                        onClick={() => setSelectedModel(model.id)}
                                        style={{ borderColor: selectedModel === model.id ? getProviderColor(model.provider) : '' }}
                                    >
                                        <div className="model-header">
                                            <span 
                                                className="provider-badge" 
                                                style={{ backgroundColor: getProviderColor(model.provider) }}
                                            >
                                                {model.provider}
                                            </span>
                                            <span 
                                                className="speed-badge" 
                                                style={{ color: speedBadge.color }}
                                                title={`Speed: ${model.speed}`}
                                            >
                                                {speedBadge.text}
                                            </span>
                                        </div>
                                        <div className="model-name">{model.name}</div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        <div className="modal-actions">
                            <button 
                                className="cancel-button" 
                                onClick={onClose}
                            >
                                Cancel
                            </button>
                            <button 
                                className="select-button" 
                                onClick={handleSelect}
                                disabled={!selectedModel}
                                style={{ 
                                    backgroundColor: selectedModel ? '#9b59b6' : '#ccc',
                                    cursor: selectedModel ? 'pointer' : 'not-allowed'
                                }}
                            >
                                Add SuperBot
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SuperBotModal;