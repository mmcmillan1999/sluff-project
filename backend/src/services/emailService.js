// backend/src/services/emailService.js

const sgMail = require('@sendgrid/mail');

// Set the API key from environment variables
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const senderEmail = process.env.SENDER_EMAIL_ADDRESS;

/**
 * Sends an email using SendGrid.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The subject line of the email.
 * @param {string} text - The plain text content of the email.
 * @param {string} html - The HTML content of the email.
 * @returns {Promise<void>}
 */
const sendEmail = async ({ to, subject, text, html }) => {
    if (!process.env.SENDGRID_API_KEY || !senderEmail) {
        console.error('🔴 SendGrid API Key or Sender Email is not configured. Email not sent.');
        // In a real production app, you might throw an error or handle this more gracefully.
        // For development, we'll log it and prevent a crash.
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
        
        // SendGrid provides detailed error information in the response
        if (error.response) {
            console.error(error.response.body);
        } else {
            console.error(error);
        }
        
        // Re-throw the error so the calling function knows something went wrong.
        throw new Error('Failed to send email.');
    }
};

module.exports = {
    sendEmail,
};