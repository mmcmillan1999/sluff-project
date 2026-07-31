import {
    clearMicCaptureRefused,
    getMicCaptureRefused,
    rememberMicCaptureRefused,
    shouldAutoUnmuteMicrophone,
} from './micPermission';

const stubPermissions = (value) => {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value });
};

describe('micPermission', () => {
    afterEach(() => {
        window.localStorage.clear();
        delete navigator.permissions;
    });

    test('remembers and clears a refusal', () => {
        expect(getMicCaptureRefused()).toBe(false);
        rememberMicCaptureRefused();
        expect(getMicCaptureRefused()).toBe(true);
        clearMicCaptureRefused();
        expect(getMicCaptureRefused()).toBe(false);
    });

    test('without a Permissions API the local memory decides', async () => {
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(true);
        rememberMicCaptureRefused();
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(false);
    });

    test('granted alone neither clears nor bypasses the memory', async () => {
        // Site-level 'granted' cannot see an OS-level block, so only a
        // capture that actually succeeds clears the flag.
        stubPermissions({ query: vi.fn(async () => ({ state: 'granted' })) });
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(true);
        rememberMicCaptureRefused();
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(false);
        expect(getMicCaptureRefused()).toBe(true);
    });

    test('denied blocks the attempt and sets the memory', async () => {
        stubPermissions({ query: vi.fn(async () => ({ state: 'denied' })) });
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(false);
        expect(getMicCaptureRefused()).toBe(true);
    });

    test('prompt defers to the local memory, as Safari masks denial that way', async () => {
        stubPermissions({ query: vi.fn(async () => ({ state: 'prompt' })) });
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(true);
        rememberMicCaptureRefused();
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(false);
    });

    test('a throwing query falls back to the local memory', async () => {
        stubPermissions({ query: vi.fn(async () => { throw new TypeError('unsupported'); }) });
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(true);
        rememberMicCaptureRefused();
        await expect(shouldAutoUnmuteMicrophone()).resolves.toBe(false);
    });
});
