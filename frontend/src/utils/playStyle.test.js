import {
    CARD_PLAY_STYLES,
    DEFAULT_CARD_PLAY_STYLE,
    getCardPlayStyle,
    setCardPlayStyle,
} from './playStyle';

describe('card play style setting', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('defaults to the flick style', () => {
        expect(DEFAULT_CARD_PLAY_STYLE).toBe('flick');
        expect(getCardPlayStyle()).toBe('flick');
    });

    test('registry offers exactly flick and fast', () => {
        expect(CARD_PLAY_STYLES.map(style => style.id)).toEqual(['flick', 'fast']);
    });

    test('persists a swap and broadcasts the change event', () => {
        const listener = vi.fn();
        window.addEventListener('sluff:play-style-changed', listener);

        const next = setCardPlayStyle('fast');

        expect(next).toBe('fast');
        expect(getCardPlayStyle()).toBe('fast');
        expect(JSON.parse(window.localStorage.getItem('sluff_card_play_style'))).toBe('fast');
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener('sluff:play-style-changed', listener);
    });

    test('rejects unknown styles without corrupting the setting', () => {
        setCardPlayStyle('fast');
        expect(setCardPlayStyle('teleport')).toBe('fast');
        expect(getCardPlayStyle()).toBe('fast');
    });

    test('falls back to the default when storage holds corrupt or stale data', () => {
        window.localStorage.setItem('sluff_card_play_style', 'not-json{');
        expect(getCardPlayStyle()).toBe('flick');

        window.localStorage.setItem('sluff_card_play_style', JSON.stringify('retired-style'));
        expect(getCardPlayStyle()).toBe('flick');
    });
});
