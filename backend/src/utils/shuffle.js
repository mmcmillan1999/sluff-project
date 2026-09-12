// Backend/utils/shuffle.js

// The deal's only source of randomness. Tests swap it for a seeded generator
// (setShuffleRandom) so a whole tournament plays the same way every run;
// production never calls that and shuffles on Math.random, looked up at call
// time as it always was.
let randomSource = null;

/**
 * Shuffles an array in place using the Fisher-Yates (aka Knuth) Shuffle.
 * @param {Array} array The array to shuffle.
 * @returns {Array} The shuffled array.
 */
const shuffle = (array) => {
    let currentIndex = array.length, randomIndex;
    // While there remain elements to shuffle.
    while (currentIndex !== 0) {
        // Pick a remaining element.
        randomIndex = Math.floor((randomSource || Math.random)() * currentIndex);
        currentIndex--;
        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }
    return array;
};

/** Tests only: a () => [0, 1) generator, or null to restore Math.random. */
const setShuffleRandom = (fn) => {
    randomSource = typeof fn === 'function' ? fn : null;
};

module.exports = { shuffle, setShuffleRandom };