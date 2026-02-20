
// whatsappService.js - Create this new service file
const axios = require('axios');
const logger = require('../config/logger');

class WhatsAppService {
  constructor() {
    this.baseURL = 'https://graph.facebook.com/v18.0';
    this.phoneNumberId = 735230829670892;
    this.accessToken = "EAAYZCiljMFKMBPMo7u7Jqig2xZB6DenvnHHN7RQGBOaB5rItrLAYJQJYAc0ZCjFvDhq0OsA2DBtUDpNBTbWCnKp1q92BKqopvtABhIGXE85e6H0jeIXCzy9E5PwXPumS23In4vCTUs4J8q2CCBDopP1FQfW9eAxmCQOHdI5YW68lTZCuWT4ZA6azITuj7efFZAe3Gr2wVgEiZA7fBUxN66CWbunqeuOQPCjL8SGRWH2rUUVcHPtD5pZBHwbETisZD";
  }

  // Format phone number to international format
  formatPhoneNumber(phone) {
    // Remove any non-digit characters
    const cleaned = phone.replace(/\D/g, '');
    
    // Add country code if not present (assuming Nigeria +234)
    if (cleaned.startsWith('0')) {
      return `234${cleaned.substring(1)}`;
    }
    if (!cleaned.startsWith('234')) {
      return `234${cleaned}`;
    }
    return cleaned;
  }

  // Send template message (requires pre-approved templates)
  async sendTemplateMessage(phoneNumber, templateName, parameters = []) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const message = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: "en"
          },
          components: [{
            type: "body",
            parameters: parameters.map(param => ({
              type: "text",
              text: param
            }))
          }]
        }
      };

      const response = await axios.post(
        `${this.baseURL}/${this.phoneNumberId}/messages`,
        message,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`WhatsApp message sent to ${formattedPhone}`, { templateName, messageId: response.data.messages[0].id });
      return response.data;
    } catch (error) {
      logger.error('WhatsApp template message error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Send simple text message (for testing - has limitations in production)
  async sendTextMessage(phoneNumber, message) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const payload = {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "text",
        text: {
          body: message
        }
      };

      const response = await axios.post(
        `${this.baseURL}/${this.phoneNumberId}/messages`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`WhatsApp text message sent to ${formattedPhone}`, { messageId: response.data.messages[0].id });
      return response.data;
    } catch (error) {
      logger.error('WhatsApp text message error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Send order status update
  async sendOrderStatusUpdate(phoneNumber, customerName, orderId, status, additionalInfo = '') {
    try {
      const statusMessages = {
        'processing': `Hi ${customerName}! Your order #${orderId} is being processed. We'll notify you once it's ready.`,
        'accepted': `Great news ${customerName}! Your order #${orderId} has been accepted and is being prepared.`,
        'rejected': `Sorry ${customerName}, your order #${orderId} has been rejected. ${additionalInfo}`,
        'en_route': `Your order #${orderId} is on the way! Our rider will deliver it shortly.`,
        'delivered': `Your order #${orderId} has been delivered successfully. Thank you for choosing us!`
      };

      const message = statusMessages[status] || `Order #${orderId} status updated to: ${status}`;
      
      // Use template message if you have approved templates, otherwise use text message
      // For production, you should use template messages with pre-approved templates
      return await this.sendTextMessage(phoneNumber, message);
      
      // Alternative: Use template message (uncomment and modify as needed)
      // return await this.sendTemplateMessage(phoneNumber, 'order_status_update', [customerName, orderId, status]);
      
    } catch (error) {
      logger.error('Failed to send order status update:', error);
      // Don't throw error to avoid breaking the main order flow
      return null;
    }
  }
}

module.exports = new WhatsAppService();