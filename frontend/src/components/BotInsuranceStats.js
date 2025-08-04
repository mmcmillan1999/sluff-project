import React, { useState, useEffect } from 'react';
import './BotInsuranceStats.css';

const BotInsuranceStats = ({ onClose }) => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchStats();
    }, []);

    const fetchStats = async () => {
        try {
            const token = localStorage.getItem('token');
            const serverUrl = process.env.REACT_APP_SERVER_URL || 'http://localhost:3005';
            const response = await fetch(`${serverUrl}/api/bot-insurance/stats`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch stats');
            }
            
            const data = await response.json();
            setStats(data);
            setLoading(false);
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    if (loading) return <div className="bot-stats-modal"><div className="bot-stats-content">Loading...</div></div>;
    if (error) return <div className="bot-stats-modal"><div className="bot-stats-content">Error: {error}</div></div>;

    return (
        <div className="bot-stats-modal">
            <div className="bot-stats-content">
                <div className="bot-stats-header">
                    <h2>Bot Insurance Performance</h2>
                    <button onClick={onClose} className="close-button">✕</button>
                </div>

                <div className="bot-stats-body">
                    <h3>Overall Performance</h3>
                    <table className="stats-table">
                        <thead>
                            <tr>
                                <th>Bot Name</th>
                                <th>Total Decisions</th>
                                <th>Deals Made</th>
                                <th>Avg Outcome</th>
                                <th>Total Saved</th>
                                <th>Total Wasted</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.overall.map(bot => (
                                <tr key={bot.bot_name}>
                                    <td>{bot.bot_name}</td>
                                    <td>{bot.total_decisions}</td>
                                    <td>{bot.deals_made} ({Math.round(bot.deals_made / bot.total_decisions * 100)}%)</td>
                                    <td className={parseFloat(bot.avg_outcome) > 0 ? 'positive' : 'negative'}>
                                        {parseFloat(bot.avg_outcome).toFixed(1)}
                                    </td>
                                    <td className="positive">+{bot.total_saved}</td>
                                    <td className="negative">-{bot.total_wasted}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    <h3>Recent Decisions</h3>
                    <div className="recent-decisions">
                        {stats.recent.slice(0, 10).map((decision, idx) => (
                            <div key={idx} className="decision-item">
                                <span className="bot-name">{decision.bot_name}</span>
                                <span className="role">{decision.is_bidder ? 'Bidder' : 'Non-bidder'}</span>
                                <span className="trick">Trick {decision.trick_number}</span>
                                <span className={decision.deal_executed ? 'deal-made' : 'deal-passed'}>
                                    {decision.deal_executed ? 'Deal Made' : 'Passed'}
                                </span>
                                <span className={decision.saved_or_wasted > 0 ? 'positive' : 'negative'}>
                                    {decision.saved_or_wasted > 0 ? '+' : ''}{decision.saved_or_wasted}
                                </span>
                            </div>
                        ))}
                    </div>

                    <p className="stats-note">
                        Bots are learning from each decision. Positive values mean points saved, negative means points wasted.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default BotInsuranceStats;