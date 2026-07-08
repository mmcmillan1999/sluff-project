import { describe, it, expect } from 'vitest';
import { extractInviteTableId, getInviteUrl } from './tableInvites';

describe('extractInviteTableId', () => {
    it('parses a full https invite URL', () => {
        expect(extractInviteTableId('https://playsluff.com/join/table-3')).toBe('table-3');
    });

    it('parses a bare path', () => {
        expect(extractInviteTableId('/join/table-12')).toBe('table-12');
    });

    it('tolerates a trailing slash', () => {
        expect(extractInviteTableId('https://playsluff.com/join/table-3/')).toBe('table-3');
    });

    it('parses the ?join= query fallback', () => {
        expect(extractInviteTableId('https://playsluff.com/?join=table-7')).toBe('table-7');
    });

    it('parses a custom-scheme deep link', () => {
        expect(extractInviteTableId('https://playsluff.com/join/table-40?utm_source=sms')).toBe('table-40');
    });

    it('returns null for non-invite URLs', () => {
        expect(extractInviteTableId('https://playsluff.com/')).toBeNull();
        expect(extractInviteTableId('https://playsluff.com/verify-email?token=abc')).toBeNull();
        expect(extractInviteTableId('/reset-password?token=abc')).toBeNull();
        expect(extractInviteTableId('')).toBeNull();
        expect(extractInviteTableId(null)).toBeNull();
    });

    it('rejects table ids with unexpected characters', () => {
        expect(extractInviteTableId('/join/table-3/extra')).toBeNull();
        expect(extractInviteTableId('/?join=<script>')).toBeNull();
    });
});

describe('getInviteUrl', () => {
    it('uses the current origin on the web', () => {
        expect(getInviteUrl('table-3')).toBe(`${window.location.origin}/join/table-3`);
    });
});
