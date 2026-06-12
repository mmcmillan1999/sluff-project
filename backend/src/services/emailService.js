// backend/src/services/emailService.js
//
// Transactional email with provider preference:
//   1. Resend (RESEND_API_KEY) — current provider, free tier
//   2. SendGrid (SENDGRID_API_KEY) — legacy fallback (account out of credits since 2025)
// Sender address comes from SENDER_EMAIL_ADDRESS (noreply@playsluff.com).

const senderEmail = process.env.SENDER_EMAIL_ADDRESS;

const sendViaResend = async ({ to, subject, text, html }) => {
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from: `Sluff <${senderEmail}>`,
            to: [to],
            subject,
            text,
            html,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend ${response.status}: ${body}`);
    }
};

const sendViaSendGrid = async ({ to, subject, text, html }) => {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({ to, from: senderEmail, subject, text, html });
};

/**
 * Sends an email using the first configured provider.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The subject line of the email.
 * @param {string} text - The plain text content of the email.
 * @param {string} html - The HTML content of the email.
 * @returns {Promise<void>}
 */
const sendEmail = async ({ to, subject, text, html }) => {
    if (!senderEmail) {
        throw new Error('SENDER_EMAIL_ADDRESS is not configured.');
    }

    try {
        if (process.env.RESEND_API_KEY) {
            await sendViaResend({ to, subject, text, html });
        } else if (process.env.SENDGRID_API_KEY) {
            await sendViaSendGrid({ to, subject, text, html });
        } else {
            throw new Error('No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY).');
        }
        console.log(`✅ Email sent successfully to ${to} with subject "${subject}"`);
    } catch (error) {
        console.error('🔴 Error sending email:', error.response?.body || error.message);
        throw new Error('Failed to send email.');
    }
};

module.exports = {
    sendEmail,
};
