// services/fast2smsService.js
const axios = require('axios');

class Fast2SMSService {
  constructor() {
    this.apiKey = process.env.FAST2SMS_API_KEY;
    // Use the DLT endpoint
    this.baseURL = 'https://www.fast2sms.com/dev/custom';
  }

  async sendOTP(phoneNumber, countryCode, otp, purpose) {
    try {
      const cleanCountryCode = countryCode.replace('+', '');
      const fullNumber = `${cleanCountryCode}${phoneNumber}`;
      
      // You MUST get these from your Fast2SMS dashboard after DLT registration
      const ENTITY_ID = process.env.FAST2SMS_ENTITY_ID; // Your 19-digit entity ID
      const TEMPLATE_ID = process.env.FAST2SMS_TEMPLATE_ID; // Your approved template ID
      const SENDER_ID = process.env.FAST2SMS_SENDER_ID || 'TXTLCL'; // Your approved sender ID
      
      // The message must EXACTLY match your approved template
      // Variables are passed separately
      let templateMessage = '';
      switch(purpose) {
        case 'registration':
          templateMessage = `Your PremiumForce registration OTP is: {#var#}. Valid for 10 minutes.`;
          break;
        case 'login':
          templateMessage = `Your PremiumForce login OTP is: {#var#}. Valid for 10 minutes.`;
          break;
        default:
          templateMessage = `Your PremiumForce verification OTP is: {#var#}. Valid for 10 minutes.`;
      }

      // DLT-compliant request format [citation:4]
      const response = await axios.post(this.baseURL, {
        route: "dlt_manual", // Important: use dlt_manual route
        requests: [
          {
            sender_id: SENDER_ID,
            entity_id: ENTITY_ID,
            template_id: TEMPLATE_ID,
            message: templateMessage,
            flash: 0,
            numbers: fullNumber,
            variables_dict: {
              var: otp // This replaces {#var#} in your template
            }
          }
        ]
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