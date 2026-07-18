import { DECK_SKINS, TRUMP_BROKEN_FX, getCosmetics, setCosmetic } from './cosmetics';

describe('cosmetics loadout', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test('defaults to the classic deck and lightning trump effect', () => {
        expect(getCosmetics()).toEqual({ deckSkin: 'classic', trumpBrokenFx: 'lightning' });
    });

    test('registries include the alpha catalogue', () => {
        expect(DECK_SKINS.map(s => s.id)).toEqual(['classic', 'mcmillan']);
        expect(TRUMP_BROKEN_FX.map(f => f.id)).toEqual(['lightning', 'shatter']);
    });

    test('persists a swap and broadcasts the change event', () => {
        const listener = vi.fn();
        window.addEventListener('sluff:cosmetics-changed', listener);

        const next = setCosmetic('deckSkin', 'mcmillan');

        expect(next.deckSkin).toBe('mcmillan');
        expect(getCosmetics().deckSkin).toBe('mcmillan');
        expect(JSON.parse(window.localStorage.getItem('sluff_cosmetics')).deckSkin).toBe('mcmillan');
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener('sluff:cosmetics-changed', listener);
    });

    test('rejects unknown keys and values without corrupting the loadout', () => {
        setCosmetic('deckSkin', 'stolen-skin');
        setCosmetic('walletDrain', 'yes');
        expect(getCosmetics()).toEqual({ deckSkin: 'classic', trumpBrokenFx: 'lightning' });
    });

    test('falls back to defaults when storage holds corrupt or stale data', () => {
        window.localStorage.setItem('sluff_cosmetics', 'not-json{');
        expect(getCosmetics()).toEqual({ deckSkin: 'classic', trumpBrokenFx: 'lightning' });

        window.localStorage.setItem('sluff_cosmetics', JSON.stringify({ deckSkin: 'retired-skin', trumpBrokenFx: 'shatter' }));
        expect(getCosmetics()).toEqual({ deckSkin: 'classic', trumpBrokenFx: 'shatter' });
    });
});
