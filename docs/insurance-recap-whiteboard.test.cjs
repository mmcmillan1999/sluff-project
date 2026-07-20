const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('../frontend/node_modules/jsdom');

const file = path.join(__dirname, 'insurance-recap-whiteboard.html');
const html = fs.readFileSync(file, 'utf8');
const browserErrors = [];
const virtualConsole = new VirtualConsole();

virtualConsole.on('jsdomError', (error) => browserErrors.push(error.message));
virtualConsole.on('error', (error) => browserErrors.push(String(error)));

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://sluff.local/insurance-recap-whiteboard',
    virtualConsole,
    beforeParse(window) {
        window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    }
});

const document = dom.window.document;
const expected = [
    ['reported-wasted-42', 'No one blinked.', ['Saved 34', 'Greedy 42', 'Lucky 8']],
    ['backed-ask-near-lock', 'Defenders lowballed.', ['Saved 21', 'Greedy 11', 'Greedy 10']],
    ['cards-equal-ask', 'Defenders lowballed.', ['Saved 1', 'Greedy 1', 'Perfect bid']],
    ['ambitious-but-correct', 'No one blinked.', ['Saved 10', 'Greedy 10', 'Perfect bid']],
    ['winning-overreach', 'Bidder overreached.', ['Wasted 6', 'Greedy 2', 'Lucky 8']],
    ['bidder-collapse', 'Bidder overreached.', ['Wasted 60', 'Lucky 20', 'Lucky 30']],
    ['exact-sixty', 'Cards matched the offers.', ['Nice try', 'Perfect bid', 'Perfect bid']],
    ['one-sided-capacity', 'Cards matched the offers.', ['Greedy 30', 'Lucky 25', 'Greedy 25']],
    ['neither-can-close', 'Defenders lowballed.', ['Saved 80', 'Greedy 40', 'Greedy 40']],
    ['maximum-close', 'No one blinked.', ['Saved 20', 'Greedy 10', 'Greedy 10']],
    ['negative-ask', 'Defenders lowballed.', ['Lucky 5', 'Greedy 10', 'Greedy 5']],
    ['untouched-defaults', null, []],
    ['mixed-signs', 'Bidder overreached.', ['Wasted 10', 'Greedy 20', 'Lucky 30']],
    ['odd-ask', 'Bidder overreached.', ['Wasted 8', 'Lucky 2', 'Lucky 6']],
    ['solo-failure', 'Bidder overreached.', ['Wasted 85', 'Lucky 30', 'Lucky 35']],
    ['heart-solo-win', 'Bidder overreached.', ['Wasted 2', 'Greedy 4', 'Lucky 6']],
    ['custom', 'No one blinked.', ['Saved 22', 'Greedy 36', 'Lucky 14']]
];

assert.strictEqual(
    document.querySelectorAll('#scenarioList [data-scenario-id]').length,
    expected.length,
    'scenario navigation should list every preset'
);
assert.strictEqual(
    document.querySelectorAll('#scenarioMatrix tr').length,
    expected.length,
    'scenario matrix should list every preset'
);

expected.forEach(([id, wantedHeadline, wantedGrades]) => {
    const button = document.querySelector(`#scenarioList [data-scenario-id="${id}"]`);
    assert(button, `missing scenario button: ${id}`);
    button.click();

    const grades = [...document.querySelectorAll('#proposedPhone .proposed-result')]
        .map((element) => element.textContent.trim());

    assert.deepStrictEqual(grades, wantedGrades, `unexpected proposed grades for ${id}`);
    const headline = document.querySelector('#proposedPhone .verdict-strip strong');
    assert.strictEqual(
        headline ? headline.textContent.trim() : null,
        wantedHeadline,
        `unexpected proposed headline for ${id}`
    );
    assert.strictEqual(
        document.querySelector('#proposedPhone .invalid-panel'),
        null,
        `${id} should remain a legal no-deal scenario`
    );
});

assert.match(document.querySelector('#proposedPhone').textContent, /Saved 22/);
assert.doesNotMatch(
    document.querySelector('#proposedPhone').textContent,
    /Decision check|Close check|even share/i,
    'the compact recap should not include the retired explanation copy'
);
assert.deepStrictEqual(browserErrors, [], 'whiteboard should render without browser errors');

console.log(`${expected.length}/${expected.length} proposed scenarios passed.`);
