// backend/src/services/emailService.js

const sgMail = require('@sendgrid/mail');

let isConfigured = false;
let configurationFailedMessage = null;

const resolveSenderEmail = () => {
    return process.env.SENDER_EMAIL_ADDRESS
        || process.env.SENDGRID_FROM_EMAIL
        || process.env.SUPPORT_EMAIL_ADDRESS
        || null;
};

const ensureSendGridConfigured = () => {
    if (isConfigured) {
        return true;
    }

    const apiKey = process.env.SENDGRID_API_KEY;

    if (!apiKey) {
        configurationFailedMessage = 'SendGrid API key is not configured.';
        console.error('🔴 SendGrid API Key is not configured. Email not sent.');
        return false;
    }

    try {
        sgMail.setApiKey(apiKey);
        isConfigured = true;
        configurationFailedMessage = null;
        return true;
    } catch (configError) {
        configurationFailedMessage = configError.message || 'Unknown configuration error.';
        console.error('🔴 Failed to configure SendGrid API Key:', configurationFailedMessage);
        return false;
    }
};

/**
 * Sends an email using SendGrid.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The subject line of the email.
 * @param {string} text - The plain text content of the email.
 * @param {string} html - The HTML content of the email.
 * @returns {Promise<void>}
 */
const sendEmail = async ({ to, subject, text, html }) => {
    const senderEmail = resolveSenderEmail();

    if (!senderEmail) {
        console.error('🔴 Sender email address is not configured. Email not sent.');
        return;
    }

    if (!ensureSendGridConfigured()) {
        console.error('🔴 SendGrid configuration failed. Email not sent.');
        if (configurationFailedMessage) {
            console.error(`    ↳ ${configurationFailedMessage}`);
        }
        return;
    }

    const msg = {
        to,
        from: senderEmail,
        subject,
        text,
        html,
    };

    try {
        await sgMail.send(msg);
        console.log(`✅ Email sent successfully to ${to} with subject "${subject}"`);
    } catch (error) {
        console.error('🔴 Error sending email via SendGrid:');

        let detailedMessage = '';

        if (error.response?.body) {
            console.error(error.response.body);
            const apiErrors = error.response.body.errors;
            if (Array.isArray(apiErrors) && apiErrors.length > 0) {
                detailedMessage = apiErrors.map(e => e.message).join(' ');
            }
        } else {
            console.error(error);
            detailedMessage = error.message || '';
        }

        const messageSuffix = detailedMessage ? ` ${detailedMessage}` : '';
        throw new Error(`Failed to send email.${messageSuffix}`);
    }
};

module.exports = {
    sendEmail,
};