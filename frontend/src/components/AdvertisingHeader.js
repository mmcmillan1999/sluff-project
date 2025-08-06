import React, { useState } from 'react';
import InGameAdBanner from './InGameAdBanner';
import './AdvertisingHeader.css';

function AdvertisingHeader({ onAdClick = () => {}, isLoading = false }) {
    const [imageLoadError, setImageLoadError] = useState(false);

    const handleAdClick = () => {
        // Track ad click for analytics
        if (typeof onAdClick === 'function') {
            onAdClick('header_banner_click');
        }
        // In a real implementation, this would redirect to the advertiser's site
        // console.log("Advertisement clicked");
    };

    const handleImageError = () => { // eslint-disable-line no-unused-vars
        setImageLoadError(true);
    };

    return (
        <div className="advertising-header">
            <div className="ad-container">
                <div 
                    className={`ad-placeholder ${isLoading ? 'loading' : ''}`}
                    onClick={handleAdClick}
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
                </div>
            </div>
        </div>
    );
}

export default AdvertisingHeader;