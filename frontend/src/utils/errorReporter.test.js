import { createErrorReporter } from './errorReporter';

describe('errorReporter', () => {
    const makeFetch = () => {
        const calls = [];
        const fetchFn = vi.fn((url, options) => {
            calls.push({ url, body: JSON.parse(options.body) });
            return Promise.resolve({ ok: true });
        });
        return { calls, fetchFn };
    };

    test('reports once per distinct error, capped per session', () => {
        const { calls, fetchFn } = makeFetch();
        const reporter = createErrorReporter({ endpoint: '/api/errors', fetchFn, maxPerSession: 3 });

        expect(reporter.report('boom', 'stack')).toBe(true);
        // A crash loop repeats the same message; one report teaches everything
        // the next hundred would.
        expect(reporter.report('boom', 'stack')).toBe(false);
        expect(reporter.report('other', 'stack')).toBe(true);
        expect(reporter.report('third', 'stack')).toBe(true);
        expect(reporter.report('fourth — over the cap', 'stack')).toBe(false);
        expect(calls).toHaveLength(3);
    });

    test('truncates the payload to what the server will keep anyway', () => {
        const { calls, fetchFn } = makeFetch();
        const reporter = createErrorReporter({ endpoint: '/api/errors', fetchFn, buildId: 'test-build' });

        reporter.report('m'.repeat(2000), 's'.repeat(9000));
        expect(calls[0].body.message).toHaveLength(500);
        expect(calls[0].body.stack).toHaveLength(4000);
        expect(calls[0].body.buildId).toBe('test-build');
    });

    test('a disabled reporter (dev builds) sends nothing', () => {
        const { calls, fetchFn } = makeFetch();
        const reporter = createErrorReporter({ endpoint: '/api/errors', fetchFn, enabled: false });

        expect(reporter.report('boom')).toBe(false);
        expect(calls).toHaveLength(0);
    });

    test('empty messages and a rejecting transport are both non-events', () => {
        const rejecting = vi.fn(() => Promise.reject(new Error('offline')));
        const reporter = createErrorReporter({ endpoint: '/api/errors', fetchFn: rejecting });

        expect(reporter.report('')).toBe(false);
        expect(reporter.report(null)).toBe(false);
        // The send itself failing must never surface: a reporter that can
        // break the app it is reporting on is worse than none.
        expect(() => reporter.report('boom')).not.toThrow();
        expect(rejecting).toHaveBeenCalledTimes(1);
    });
});
