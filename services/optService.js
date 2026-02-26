const twilio = require('twilio');
const { generateOTP } = require('../utils/authUtils');

class OTPService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
  }

  // Send OTP via SMS
  async sendSMS(phoneNumber, countryCode, otp) {
    try {
      const message = await this.client.messages.create({
        body: `Your verification code is: ${otp}. Valid for 5 minutes.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: `${countryCode}${phoneNumber}`
      });
      
      return { success: true, messageId: message.sid };
    } catch (error) {
      console.error('SMS sending failed:', error);
      throw new Error('Failed to send OTP via SMS');
    }
  }

  // Send OTP via WhatsApp (optional)
  async sendWhatsApp(phoneNumber, countryCode, otp) {
    try {
      const message = await this.client.messages.create({
        body: `Your verification code is: *${otp}*\nValid for 5 minutes.`,
        from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
        to: `whatsapp:${countryCode}${phoneNumber}`
      });
      
      return { success: true, messageId: message.sid };
    } catch (error) {
      console.error('WhatsApp sending failed:', error);
      // Don't throw, just log - fallback to SMS
      return { success: false };
    }
  }

  // Send OTP via both channels
  async sendOTP(phoneNumber, countryCode, otp, options = {}) {
    const results = {
      sms: null,
      whatsapp: null
    };

    // Send SMS
    results.sms = await this.sendSMS(phoneNumber, countryCode, otp);

    // Send WhatsApp if enabled
    if (options.sendWhatsApp) {
      results.whatsapp = await this.sendWhatsApp(phoneNumber, countryCode, otp);
    }

    return results;
  }

  // For development/testing - log OTP
  logOTP(phoneNumber, otp) {
    console.log(`[DEV] OTP for ${phoneNumber}: ${otp}`);
    return { success: true, dev: true };
  }
}

module.exports = new OTPService();
