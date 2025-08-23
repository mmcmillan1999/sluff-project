// frontend/src/components/InGameAdBanner.js
import React from 'react';

// --- Ad Content & Styling (All in one place for simplicity) ---

const styles = {
    adContainer: {
        width: '100%',  // Fill available width
        height: '100%', // Fill available height
        backgroundColor: '#1a1a1a',
        border: '0.1vh solid #444',
        borderRadius: '0.8vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        fontFamily: "'Oswald', sans-serif",
        color: '#e0e0e0',
        padding: '0 1.5vh',
        boxSizing: 'border-box',
    },
    logo: {
        height: '70%',  // Scale with container
        marginRight: '1.5vh',
    },
    textContainer: {
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        lineHeight: '1.2',
    },
    mainText: {
        fontSize: '2.2vh',  // Scale with viewport height
        fontWeight: 'bold',
        color: 'white',
        margin: 0,
    },
    subText: {
        fontSize: '1.8vh',  // Scale with viewport height
        color: '#ffc107', // Gold accent
        margin: 0,
    },
    icon: {
        fontSize: '3.5vh',  // Scale with viewport height
        marginRight: '1.5vh',
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