import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(
    resolve(process.cwd(), 'src/components/game/PlayerSeat.css'),
    'utf8',
);

const escapeForRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches rules whose (possibly grouped) selector line starts with exactly
// the requested selector, so `.dealer-puck-ear` cannot accidentally read the
// `.player-seat-left.wide-mode .dealer-puck-ear` override. A selector may
// appear in several rules (position group + transform override); the first
// rule declaring the property wins.
const getDeclaration = (selector, property) => {
    const rulePattern = new RegExp(`(?:^|\\n)\\s*${escapeForRegex(selector)}\\s*\\{([^}]*)\\}`, 'g');
    let sawRule = false;
    for (const rule of stylesheet.matchAll(rulePattern)) {
        sawRule = true;
        const declaration = rule[1].match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
        if (declaration) return declaration[1].replace(/\s+/g, ' ').trim();
    }
    if (!sawRule) throw new Error(`Missing CSS rule for ${selector}`);
    throw new Error(`Missing ${property} declaration for ${selector}`);
};

describe('player-seat ornament layout', () => {
    test('rests the dealer and trump pucks flush inside opposite lower plaque corners', () => {
        // The chip bank owns the top plaque edge; the pucks own the bottom.
        //
        // "Flush" is a relationship, not a magic number: each puck is centred on
        // its inset by the translate, so the inset must be exactly half the puck
        // width or the puck hangs off the plaque or floats inside it. Asserting
        // the relationship means resizing the puck cannot silently unseat it —
        // which is what a hardcoded 1.95vh let happen when the face grew.
        const vh = value => Number.parseFloat(value);
        const puckWidth = vh(getDeclaration('.player-seat-wrapper .seat-puck', '--puck-d'));
        const halfPuck = puckWidth / 2;

        expect(vh(getDeclaration('.dealer-puck-ear', 'left'))).toBeCloseTo(halfPuck, 2);
        expect(getDeclaration('.dealer-puck-ear', 'transform')).toBe('translateX(-50%)');
        expect(vh(getDeclaration('.bidder-puck-ear', 'right'))).toBeCloseTo(halfPuck, 2);
        expect(getDeclaration('.bidder-puck-ear', 'transform')).toBe('translateX(50%)');
        expect(getDeclaration('.dealer-puck-ear', 'bottom'))
            .toBe(getDeclaration('.bidder-puck-ear', 'bottom'));
    });

    test('counter-rotates the pucks in the rotated phone-layout side seats', () => {
        expect(getDeclaration('.player-seat-left.wide-mode .dealer-puck-ear', 'transform'))
            .toBe('translateX(-50%) rotate(-90deg)');
        expect(getDeclaration('.player-seat-left.wide-mode .bidder-puck-ear', 'transform'))
            .toBe('translateX(50%) rotate(-90deg)');
        expect(getDeclaration('.player-seat-right.wide-mode .dealer-puck-ear', 'transform'))
            .toBe('translateX(-50%) rotate(90deg)');
        expect(getDeclaration('.player-seat-right.wide-mode .bidder-puck-ear', 'transform'))
            .toBe('translateX(50%) rotate(90deg)');
    });

    test('rests the bottom and side chip banks halfway across the plaque edge', () => {
        expect(getDeclaration('.player-seat-wrapper > .score-chip-bank', 'top')).toBe('-0.5vh');
        expect(getDeclaration('.player-seat-wrapper > .score-chip-bank', 'transform'))
            .toBe('translate(-50%, -50%)');
    });

    test('mirrors the chip overlap for the north seat', () => {
        expect(getDeclaration('.player-seat-wrapper-top > .score-chip-bank', 'bottom')).toBe('0.5vh');
        expect(getDeclaration('.player-seat-wrapper-top > .score-chip-bank', 'transform'))
            .toBe('translate(-50%, 50%)');
    });
});
