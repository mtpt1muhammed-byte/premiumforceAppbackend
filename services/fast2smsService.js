// services/fast2smsService.js
const axios = require('axios');

class Fast2SMSService {
  constructor() {
    this.apiKey = process.env.FAST2SMS_API_KEY;
    this.baseURL = 'https://www.fast2sms.com/dev/bulkV2';
  }

  async sendOTP(phoneNumber, countryCode, otp, purpose) {
    try {
      // Remove any '+' from country code and ensure phone number is clean
      const cleanCountryCode = countryCode.replace('+', '');
      const fullNumber = `${cleanCountryCode}${phoneNumber}`;
      
      let message = '';
      switch(purpose) {
        case 'registration':
          message = `Your PremiumForce registration OTP is: ${otp}. Valid for 10 minutes.`;
          break;
        case 'login':
          message = `Your PremiumForce login OTP is: ${otp}. Valid for 10 minutes.`;
          break;
        case 'password_reset':
          message = `Your PremiumForce password reset OTP is: ${otp}. Valid for 10 minutes.`;
          break;
        default:
          message = `Your PremiumForce verification OTP is: ${otp}. Valid for 10 minutes.`;
      }

      const response = await axios.post(this.baseURL, {
        route: process.env.FAST2SMS_ROUTE || 'qt',
        sender_id: process.env.FAST2SMS_SENDER_ID || 'TXTLCL',
        message: message,
        language: 'english',
        flash: 0,
        numbers: fullNumber,
      }, {
        headers: {
          'authorization': this.apiKey,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      console.error('Fast2SMS Error:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data || error.message
      };
    }
  }
}

module.exports = new Fast2SMSService();
