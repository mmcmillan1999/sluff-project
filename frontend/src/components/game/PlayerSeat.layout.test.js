import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(
    resolve(process.cwd(), 'src/components/game/PlayerSeat.css'),
    'utf8',
);

const getDeclaration = (selector, property) => {
    const selectorStart = stylesheet.lastIndexOf(`${selector} {`);
    if (selectorStart === -1) throw new Error(`Missing CSS rule for ${selector}`);

    const blockStart = stylesheet.indexOf('{', selectorStart);
    const blockEnd = stylesheet.indexOf('}', blockStart);
    const block = stylesheet.slice(blockStart + 1, blockEnd);
    const match = block.match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
    if (!match) throw new Error(`Missing ${property} declaration for ${selector}`);

    return match[1].replace(/\s+/g, ' ').trim();
};

describe('player-seat ornament layout', () => {
    test('centers the dealer and trump pucks on opposite plaque corners', () => {
        expect(getDeclaration('.dealer-puck-ear', 'left')).toBe('0');
        expect(getDeclaration('.dealer-puck-ear', 'transform')).toBe('translateX(-50%)');
        expect(getDeclaration('.bidder-puck-ear', 'right')).toBe('0');
        expect(getDeclaration('.bidder-puck-ear', 'transform')).toBe('translateX(50%)');
        expect(getDeclaration('.dealer-puck-ear', 'bottom'))
            .toBe(getDeclaration('.bidder-puck-ear', 'bottom'));
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
