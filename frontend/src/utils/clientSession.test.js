// The module decides at load whether this page is a deliberate open, so each
// case boots a fresh copy of it against the storage and visibility it needs.
const boot = async ({ visibility = 'visible' } = {}) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    vi.resetModules();
    return import('./clientSession');
};

const handshake = (session, token = 'jwt') => {
    let sent = null;
    session.socketAuthFor(token)((auth) => { sent = auth; });
    return sent;
};

describe('clientSession', () => {
    afterEach(() => {
        window.sessionStorage.clear();
        delete document.visibilityState;
    });

    test('a page the player is looking at opens with a claim, once', async () => {
        const session = await boot();
        expect(handshake(session)).toMatchObject({ token: 'jwt', intent: 'claim' });
        // A failed first attempt retries with the claim still attached.
        expect(handshake(session).intent).toBe('claim');
        session.settleClaim();
        // Every reconnect after that is the machine, not the player.
        expect(handshake(session).intent).toBe('resume');
    });

    test('a tab restored in the background never claims', async () => {
        const session = await boot({ visibility: 'hidden' });
        expect(handshake(session).intent).toBe('resume');
    });

    test('the client id survives a reload and matches what the server accepts', async () => {
        const first = await boot();
        const id = first.clientId();
        expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        const reloaded = await boot();
        expect(reloaded.clientId()).toBe(id);
        window.sessionStorage.clear();
        const otherTab = await boot();
        expect(otherTab.clientId()).not.toBe(id);
    });

    test('a junk stored id is replaced rather than sent', async () => {
        window.sessionStorage.setItem('sluff_client_id', 'no good');
        const session = await boot();
        expect(session.clientId()).toMatch(/^[0-9a-f]{32}$/);
    });

    test('an automatic version reload boots as a resume, the next manual load as a claim', async () => {
        const before = await boot();
        before.markAutoReload();
        const reloaded = await boot();
        expect(handshake(reloaded).intent).toBe('resume');
        const manual = await boot();
        expect(handshake(manual).intent).toBe('claim');
    });

    test('parking survives a reload and only an explicit request claims again', async () => {
        const session = await boot();
        session.setParked('active-elsewhere');
        const reloaded = await boot();
        expect(reloaded.parkedAs()).toBe('active-elsewhere');
        expect(handshake(reloaded).intent).toBe('resume');
        // "Play here"
        reloaded.setParked(null);
        reloaded.requestClaim();
        expect(reloaded.parkedAs()).toBe(null);
        expect(handshake(reloaded).intent).toBe('claim');
        const afterwards = await boot();
        expect(afterwards.parkedAs()).toBe(null);
    });

    test('blocked sessionStorage degrades to a per-load client instead of throwing', async () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        const removeItem = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
        try {
            const session = await boot();
            expect(session.clientId()).toMatch(/^[0-9a-f]{32}$/);
            expect(session.clientId()).toBe(session.clientId());
            session.setParked('claimed-elsewhere');
            expect(session.parkedAs()).toBe('claimed-elsewhere');
            expect(() => session.markAutoReload()).not.toThrow();
        } finally {
            getItem.mockRestore();
            setItem.mockRestore();
            removeItem.mockRestore();
        }
    });
});
