// frontend/src/bulletinContent.js

/**
 * This file holds the content for the lobby bulletin.
 * To update the bulletin, simply edit the text in the 'content' array.
 * 
 * Supported types:
 * - 'header': A main title for a section.
 * - 'paragraph': A regular block of text.
 * - 'list-item': An item in a bulleted list.
 */

export const bulletinContent = [
    {
        type: 'header',
        text: 'Deployment Test: Success!'
    },
    {
        type: 'list-item',
        text: 'This change confirms the new deployment pipeline is working correctly.'
    },
    { 
        type: 'header', 
        text: 'Welcome to Sluff Alpha Testing!' 
    },
    { 
        type: 'paragraph', 
        text: 'better ways to log bugs coming.' 
    },
    { 
        type: 'header', 
        text: 'Recent Changes' 
    },
    { 
        type: 'list-item', 
        text: 'Added "Offer Draw" logic for ending games.' 
    },
    { 
        type: 'list-item', 
        text: 'Improved insurance panel buttons for more intuitive dealing.' 
    },
    { 
        type: 'list-item', 
        text: 'Fixed several bugs related to token calculation after a game finishes.' 
    },
    { 
        type: 'header', 
        text: 'On Deck' 
    },
    { 
        type: 'list-item', 
        text: 'A "Training Table" with lower stakes and UI helpers for new players.' 
    },
    { 
        type: 'list-item', 
        text: 'Improved backend logic for more detailed win/loss/forfeit tracking.' 
    },
    { 
        type: 'list-item', 
        text: 'An in-game tool for submitting feedback directly.' 
    },
    { 
        type: 'list-item', 
        text: 'First version of Bot players to fill empty seats.' 
    },
];
