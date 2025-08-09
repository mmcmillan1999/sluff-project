import React, { useState } from 'react';
import InGameAdBanner from './InGameAdBanner';
import './AdvertisingHeader.css';

function AdvertisingHeader({ onAdClick = () => {}, eligibleForMercy = false, isLoading = false, clickUrl = 'https://playsluff.com' }) {
    const [imageLoadError, setImageLoadError] = useState(false);

    const handleAdClick = () => {
        // Track ad click for analytics
        if (typeof onAdClick === 'function') {
            onAdClick('header_banner_click');
        }
        // Redirect to sponsor/ad link (default to playsluff.com)
        const url = clickUrl || 'https://playsluff.com';
        try {
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            if (win) win.opener = null;
        } catch (e) {
            window.location.href = url;
        }
    };

    const handleImageError = () => { // eslint-disable-line no-unused-vars
        setImageLoadError(true);
    };

    return (
        <div className="advertising-header">
            <div className="ad-container">
                <div 
                    className={`ad-placeholder ${isLoading ? 'loading' : ''} ${eligibleForMercy ? 'ad-attention' : ''}`}
                    onClick={handleAdClick}
                    role="link"
                    tabIndex={0}
                    aria-label="Visit sponsor website"
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAdClick(); } }}
                >
                    {imageLoadError ? (
                        <div className="ad-fallback">
                            <span>Advertisement Space Available</span>
                        </div>
                    ) : (
                        <div className="ad-banner-wrapper">
                            <InGameAdBanner />
                        </div>
                    )}
                    {/* No clickable CTA overlay; keep attention via subtle glow only */}
                </div>
            </div>
        </div>
    );
}

export default AdvertisingHeader;