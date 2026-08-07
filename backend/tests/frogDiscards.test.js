// backend/tests/frogDiscards.test.js
// The frog discard policies. The 'matt' rule chain is the crowned default
// contender (sim: -3.5/frog for the old lowest-rank rule -> +18..+20): bank
// hanging 10s, strip ace suits to the bare ace, void ownerless suits, and
// never strip the guards of a 10 that stays behind.

const assert = require('assert');
const {
    FROG_DISCARD_STRATEGIES,
    frogDiscardStrategyFor,
    registerFrogDiscardProfile,
    FROG_DISCARD_PROFILES,
} = require('../src/core/frogDiscards');

const { lowest, matt, scorer } = FROG_DISCARD_STRATEGIES;

async function runFrogDiscardTests() {
    console.log('Running frog discard tests...');
    let testCounter = 1;
    const pass = (name) => console.log(`  ✔ Test ${testCounter++}: ${name}`);

    // 1) A naked 10 is the first thing banked, and an ace suit strips to
    //    the bare ace (Matt's A-J-6 example).
    {
        const hand = ['AH', 'KH', 'QH', '9H', '8H', '7H', '6H',
            '10S', 'AD', 'JD', '6D', '10C', '9C', 'KC'];
        const discards = matt(hand);
        assert.strictEqual(discards.length, 3);
        assert.ok(discards.includes('10S'), 'the naked 10 is banked');
        assert.ok(discards.includes('JD') && discards.includes('6D'),
            'the ace suit strips to its bare ace');
        assert.ok(!discards.includes('AD'), 'the ace itself never leaves');
        pass('Naked 10 banked, A-J-6 stripped to the bare ace.');
    }

    // 2) The zing suit: a 10 with one low guard goes to the bank WITH its
    //    guard — ten points banked plus a void, instead of the 9-lead trap.
    {
        const hand = ['AH', 'KH', 'QH', 'JH', '9H', '8H', '7H', '6H',
            '10S', '9S', 'AD', '10D', '7C', '6C'];
        const discards = matt(hand);
        assert.ok(discards.includes('10S') && discards.includes('9S'),
            'the 10-9 zing suit banks the 10 and voids with the guard');
        assert.ok(!discards.includes('10D'), 'the ace-guarded 10 stays home');
        pass('The 10-9 zing suit is banked whole; the ace-guarded 10 stays.');
    }

    // 3) Guard integrity: with a properly guarded 10 kept, the policy voids
    //    an ownerless suit (banking its king) rather than plucking guards.
    {
        const hand = ['AH', 'KH', 'QH', 'JH', '9H', '8H', '6H',
            '10S', '9S', '7S', '6C', '7C', '8D', 'KD'];
        const discards = matt(hand);
        assert.ok(!discards.some(card => ['10S', '9S', '7S'].includes(card)),
            'the guarded 10 keeps every guard');
        assert.ok(discards.includes('KD') && discards.includes('8D'),
            'the ownerless diamond suit voids, banking the king');
        pass('Guards stay with their 10; the void banks the king instead.');
    }

    // 4) The old policy is preserved verbatim as the baseline, quirks and
    //    all: three lowest non-hearts, even when that strips a guard.
    {
        const hand = ['AH', 'KH', 'QH', 'JH', '9H', '8H', '6H',
            '10S', '9S', '7S', '6C', '7C', '8D', 'KD'];
        assert.deepStrictEqual(lowest(hand).sort(), ['6C', '7C', '7S'].sort());
        pass('The lowest baseline still strips guards — locked for reference.');
    }

    // 5) Degenerate hands still produce exactly three discards (the old
    //    one-liner could come up short on a hearts-flooded hand).
    {
        const hand = ['AH', 'KH', 'QH', 'JH', '10H', '9H', '8H', '7H', '6H',
            'AS', '10D', 'AC', '6C', '7C'];
        for (const policy of [lowest, matt, scorer]) {
            const discards = policy(hand);
            assert.strictEqual(discards.length, 3, 'always exactly three');
            assert.strictEqual(new Set(discards).size, 3, 'all distinct');
            for (const card of discards) assert.ok(hand.includes(card));
        }
        const nearAllHearts = ['AH', 'KH', 'QH', 'JH', '10H', '9H', '8H',
            '7H', '6H', 'AS', '6S', 'AD', 'AC', '10C'];
        for (const policy of [lowest, matt]) {
            assert.strictEqual(policy(nearAllHearts).length, 3,
                'hearts pad the discard when side suits run out');
        }
        pass('Every policy returns three valid discards, even on degenerate hands.');
    }

    // 6) Registry: the crowned matt chain is the default, profiles
    //    override, unknowns are refused.
    {
        assert.strictEqual(frogDiscardStrategyFor('Anybody'), matt);
        registerFrogDiscardProfile('Sim Seat', 'lowest');
        assert.strictEqual(frogDiscardStrategyFor('Sim Seat'), lowest);
        assert.throws(() => registerFrogDiscardProfile('X', 'coin-flip'));
        delete FROG_DISCARD_PROFILES['Sim Seat'];
        pass('The registry defaults to matt, overrides, and refuses unknown policies.');
    }

    console.log('Frog discard tests passed.');
}

module.exports = runFrogDiscardTests;

if (require.main === module) {
    runFrogDiscardTests().catch(error => { console.error(error); process.exitCode = 1; });
}
