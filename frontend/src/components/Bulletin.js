import React from 'react';
import './Bulletin.css';
// --- MODIFICATION: Corrected the import path to be local ---
import { bulletinContent } from './BulletinContent';

/**
 * A component to display news and updates in the lobby.
 * It reads from a static content file for easy updates.
 */
const Bulletin = () => {
    return (
        <div className="bulletin-container">
            {bulletinContent.map((item, index) => {
                switch (item.type) {
                    case 'header':
                        return <h3 key={index} className="bulletin-header">{item.text}</h3>;
                    case 'paragraph':
                        return <p key={index} className="bulletin-paragraph">{item.text}</p>;
                    case 'list-item':
                        // To ensure valid HTML, we render a list item.
                        // The CSS will provide the bullet point.
                        return <div key={index} className="bulletin-list-item">{item.text}</div>;
                    default:
                        return null;
                }
            })}
        </div>
    );
};

export default Bulletin;