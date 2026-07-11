function createGameServiceWithoutHeartbeat(GameService, ...constructorArgs) {
    const originalSetInterval = global.setInterval;

    // GameService's production heartbeat is useful at runtime, but a repeating
    // timer makes imported test suites hang and introduces wall-clock races.
    global.setInterval = () => ({ unref() {} });
    try {
        return new GameService(...constructorArgs);
    } finally {
        global.setInterval = originalSetInterval;
    }
}

async function withControlledTimeouts(callback) {
    const originalSetTimeout = global.setTimeout;
    const timers = [];

    global.setTimeout = (timerCallback, duration, ...args) => {
        const timer = { callback: timerCallback, duration, args, cleared: false };
        timers.push(timer);
        return timer;
    };

    try {
        return await callback({
            timers,
            async runNext() {
                const timer = timers.shift();
                if (!timer) throw new Error('Expected a scheduled timeout, but none was queued.');
                if (!timer.cleared) await timer.callback(...timer.args);
                return timer;
            },
        });
    } finally {
        global.setTimeout = originalSetTimeout;
    }
}

module.exports = {
    createGameServiceWithoutHeartbeat,
    withControlledTimeouts,
};
