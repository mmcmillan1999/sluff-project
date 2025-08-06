// frontend/src/components/InGameAdBanner.js
import React from 'react';

// --- Ad Content & Styling (All in one place for simplicity) ---

const styles = {
    adContainer: {
        width: '320px',
        height: '50px',
        backgroundColor: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Oswald', sans-serif",
        color: '#e0e0e0',
        padding: '0 10px',
        boxSizing: 'border-box',
    },
    logo: {
        height: '35px',
        marginRight: '10px',
    },
    textContainer: {
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        lineHeight: '1.2',
    },
    mainText: {
        fontSize: '14px',
        fontWeight: 'bold',
        color: 'white',
        margin: 0,
    },
    subText: {
        fontSize: '11px',
        color: '#ffc107', // Gold accent
        margin: 0,
    },
    icon: {
        fontSize: '24px',
        marginRight: '10px',
    },
};

// --- Individual Ad Variations ---

// Ad 1: Standard Brand Ad
const AdBrand = () => (
    <div style={styles.adContainer}>
        <img src="/SluffLogo.png" alt="Sluff Logo" style={styles.logo} />
        <div style={styles.textContainer}>
            <p style={styles.mainText}>The Thinking Player's Game</p>
            <p style={styles.subText}>playsluff.com</p>
        </div>
    </div>
);

// Ad 2: Feature Tease (from your roadmap)
const AdFeatureTease = () => (
    <div style={styles.adContainer}>
        <span style={styles.icon}>🏆</span>
        <div style={styles.textContainer}>
            <p style={styles.mainText}>TOURNAMENT MODE</p>
            <p style={styles.subText}>Coming Soon! Prove you're the best.</p>
        </div>
    </div>
);

// Ad 3: Gameplay Hook (from your game logic)
const AdGameplayHook = () => (
    <div style={styles.adContainer}>
        <span style={styles.icon}>🐸</span>
        <div style={styles.textContainer}>
            <p style={styles.mainText}>What's your next bid?</p>
            <p style={styles.subText}>Master the Frog, Solo, & Heart Solo.</p>
        </div>
    </div>
);


// --- Main Banner Component with Rotation Logic ---

const adComponents = [AdBrand, AdFeatureTease, AdGameplayHook];

const InGameAdBanner = () => {
    const [currentAdIndex, setCurrentAdIndex] = React.useState(0);

    React.useEffect(() => {
        const rotationInterval = setInterval(() => {
            setCurrentAdIndex(prevIndex => (prevIndex + 1) % adComponents.length);
        }, 10000); // Rotate every 10 seconds

        return () => clearInterval(rotationInterval);
    }, []);

    const CurrentAd = adComponents[currentAdIndex];

    return <CurrentAd />;
};

export default InGameAdBanner;