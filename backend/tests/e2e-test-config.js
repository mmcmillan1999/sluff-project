function loadRequiredEnvironment(testName, variableNames) {
    const missingVariables = variableNames.filter((name) => {
        const value = process.env[name];
        return typeof value !== 'string' || value.trim() === '';
    });

    if (missingVariables.length > 0) {
        console.log(
            `[SKIP] ${testName}: set ${missingVariables.join(', ')} to run this opt-in test.`
        );
        return null;
    }

    return Object.fromEntries(variableNames.map((name) => [name, process.env[name]]));
}

function isLoopbackTarget(target) {
    try {
        const hostname = new URL(target).hostname.toLowerCase();
        return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    } catch (_error) {
        return false;
    }
}

function remoteTargetsAreAllowed(testName, targets) {
    const remoteTargets = targets.filter((target) => !isLoopbackTarget(target));

    if (remoteTargets.length > 0 && process.env.SLUFF_E2E_ALLOW_REMOTE !== 'true') {
        console.log(
            `[SKIP] ${testName}: a configured target is not local. ` +
            'Set SLUFF_E2E_ALLOW_REMOTE=true only when remote E2E access is intentional.'
        );
        return false;
    }

    return true;
}

function withoutTrailingSlash(url) {
    return url.replace(/\/+$/, '');
}

module.exports = {
    loadRequiredEnvironment,
    remoteTargetsAreAllowed,
    withoutTrailingSlash,
};
