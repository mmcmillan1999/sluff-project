import { describe, expect, test } from 'vitest';
import { bulletinEntries, bulletinTickerItems } from './BulletinContent';

describe('BulletinContent public copy', () => {
    test('does not expose automated or human seat classifications', () => {
        const publicCopy = JSON.stringify({ bulletinEntries, bulletinTickerItems });

        expect(publicCopy).not.toMatch(/\b(?:bots?|humans?)\b/i);
    });
});
