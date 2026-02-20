
// config/emailService.js
const nodemailer = require('nodemailer');
const logger = require('../config/logger');
require('dotenv').config();

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtppro.zoho.com',
      port: parseInt(process.env.EMAIL_PORT, 10) || 465,
      secure: process.env.EMAIL_SECURE === 'true',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      logger: true, // Enable Nodemailer debug logging
      debug: true,  // Show detailed SMTP logs
      tls: { ciphers: process.env.EMAIL_PORT === '587' ? 'SSLv3' : undefined },
    });
  }

  formatEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }
    return email.trim();
  }

  async sendTextEmail(email, subject, message, options = {}) {
    try {
      const formattedEmail = this.formatEmail(email);
      const mailOptions = {
        from: `"Ollan Pharmacy" <${process.env.EMAIL_FROM}>`,
        to: formattedEmail,
        subject,
        text: message,
        html: `<p>${message.replace(/\n/g, '<br>')}</p>`, // Convert newlines to <br> for HTML
        ...options, // Spread options to include attachments or other mail options
      };
      const info = await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${formattedEmail}`, { messageId: info.messageId });
      return info;
    } catch (error) {
      logger.error('Email sending error:', error.message, { stack: error.stack });
      throw error;
    }
  }

  async sendOrderStatusUpdate(email, customerName, orderId, status, additionalInfo = '') {
    try {
      const statusMessages = {
        processing: `Hi ${customerName}! Your order #${orderId} is being processed. We'll notify you once it's ready.`,
        accepted: `Great news ${customerName}! Your order #${orderId} has been accepted and is being prepared.`,
        rejected: `Sorry ${customerName}, your order #${orderId} has been rejected. ${additionalInfo}`,
        en_route: `Your order #${orderId} is on the way! Our rider will deliver it shortly.`,
        delivered: `Your order #${orderId} has been delivered successfully. Thank you for choosing us!`,
      };
      const message = statusMessages[status] || `Order #${orderId} status updated to: ${status}`;
      const subject = `Ollan Pharmacy: Order #${orderId} Update`;
      return await this.sendTextEmail(email, subject, message);
    } catch (error) {
      logger.error('Failed to send order status email:', error.message, { stack: error.stack });
      return null;
    }
  }
}

module.exports = new EmailService();