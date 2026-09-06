import { useEffect, useState } from 'react';

// Counts a server-supplied "seconds until" figure down locally, restarting
// whenever a fresh figure arrives.
export const useCountdown = (seconds) => {
    const [left, setLeft] = useState(seconds);
    useEffect(() => {
        setLeft(seconds);
        if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
        const timer = setInterval(() => setLeft(value => (value > 0 ? value - 1 : 0)), 1000);
        return () => clearInterval(timer);
    }, [seconds]);
    return left;
};

export default useCountdown;
