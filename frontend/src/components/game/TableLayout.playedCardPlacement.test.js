import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(
    resolve(process.cwd(), 'src/components/game/TableLayout.css'),
    'utf8',
);

const getDeclaration = (selector, property) => {
    // Use the final occurrence so a selector listed last in a grouped base
    // rule does not hide its later, position-specific rule.
    const selectorStart = stylesheet.lastIndexOf(`${selector} {`);
    if (selectorStart === -1) throw new Error(`Missing CSS rule for ${selector}`);

    const blockStart = stylesheet.indexOf('{', selectorStart);
    const blockEnd = stylesheet.indexOf('}', blockStart);
    const block = stylesheet.slice(blockStart + 1, blockEnd);
    const match = block.match(new RegExp(`${property}\\s*:\\s*([^;]+);`));
    if (!match) throw new Error(`Missing ${property} declaration for ${selector}`);

    return match[1].replace(/\s+/g, ' ').trim();
};

describe('played-card landing geometry', () => {
    test('keeps the bottom slot fixed and mirrors the top slot across the side centerline', () => {
        expect(getDeclaration('.played-card-bottom', 'bottom')).toBe('30%');
        expect(getDeclaration('.played-card-left', 'top')).toBe('50%');
        expect(getDeclaration('.played-card-right', 'top')).toBe('50%');
        expect(getDeclaration('.played-card-top', 'top')).toBe('30%');
    });

    test('moves both side slots inward by the same portrait-safe two percent', () => {
        expect(getDeclaration('.game-table', '--played-card-side-nudge')).toBe('min(2vw, 1.5vh)');
        expect(getDeclaration('.played-card-left', 'right'))
            .toBe('calc(50% + 6.07vh - var(--played-card-side-nudge))');
        expect(getDeclaration('.played-card-right', 'left'))
            .toBe('calc(50% + 6.07vh - var(--played-card-side-nudge))');
    });

    test('keeps dormant development outlines aligned with production slots', () => {
        expect(getDeclaration('.card-drop-zone-test.bottom', 'bottom')).toBe('30%');
        expect(getDeclaration('.card-drop-zone-test.left', 'right'))
            .toBe('calc(50% + 6.07vh - var(--played-card-side-nudge))');
        expect(getDeclaration('.card-drop-zone-test.right', 'left'))
            .toBe('calc(50% + 6.07vh - var(--played-card-side-nudge))');
        expect(getDeclaration('.card-drop-zone-test.top', 'top')).toBe('30%');
    });
});
