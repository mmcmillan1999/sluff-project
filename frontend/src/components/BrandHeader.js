// frontend/src/components/BrandHeader.js
// Sluff-branded top strip. Occupies the same fixed 7.5vh slot the ad banner
// used, because the lobby and game layouts are tuned around that offset
// (GameTableView.css positions elements "just below the 7.5vh header").
// When monetization returns, swap this back for AdvertisingHeader.
import React from 'react';
import './BrandHeader.css';

const BrandHeader = ({ viewType = 'default' }) => (
    <div className={`brand-header brand-header--${viewType}`}>
        <img className="brand-header-logo" src="/SluffLogo.png" alt="" aria-hidden="true" />
        <div className="brand-header-text">
            <span className="brand-header-season">Alpha Season 2</span>
            <span className="brand-header-tagline">The leaderboard is live</span>
        </div>
    </div>
);

export default BrandHeader;
