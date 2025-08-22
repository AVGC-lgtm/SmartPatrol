const nodemailer = require('nodemailer');

// Email configuration - should be in .env file in production
const EMAIL_CONFIG = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
};

// Create transporter
const transporter = nodemailer.createTransport(EMAIL_CONFIG);

// Send registration email with credentials
const sendRegistrationEmail = async (userEmail, userData) => {
  try {
    const { name, username, password } = userData;

    const mailOptions = {
      from: `"Smart Patrolling System" <${EMAIL_CONFIG.auth.user}>`,
      to: userEmail,
      subject: 'Welcome to Smart Patrolling System - Your Login Credentials',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f4f4f4;
            }
            .header {
              background-color: #007bff;
              color: white;
              padding: 20px;
              text-align: center;
              border-radius: 5px 5px 0 0;
            }
            .content {
              background-color: white;
              padding: 30px;
              border-radius: 0 0 5px 5px;
              box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            }
            .credentials {
              background-color: #f8f9fa;
              padding: 20px;
              border-radius: 5px;
              margin: 20px 0;
              border-left: 4px solid #007bff;
            }
            .credentials p {
              margin: 10px 0;
            }
            .credentials strong {
              color: #007bff;
            }
            .footer {
              text-align: center;
              margin-top: 20px;
              color: #666;
              font-size: 14px;
            }
            .warning {
              background-color: #fff3cd;
              color: #856404;
              padding: 15px;
              border-radius: 5px;
              margin-top: 20px;
              border-left: 4px solid #ffc107;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Smart Patrolling System</h1>
            </div>
            <div class="content">
              <h2>Hello ${name},</h2>
              <p>Your account has been successfully created in the Smart Patrolling System. Below are your login credentials:</p>
              
              <div class="credentials">
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>Password:</strong> ${password}</p>
              </div>
              
              <p>You can now log in to the system using these credentials.</p>
              
              <div class="warning">
                <strong>Security Notice:</strong>
                <ul>
                  <li>Please keep your credentials secure and do not share them with anyone.</li>
                  <li>We recommend changing your password after your first login.</li>
                  <li>If you did not request this account, please contact your administrator immediately.</li>
                </ul>
              </div>
              
              <p>If you have any questions or need assistance, please contact your system administrator.</p>
              
              <p>Best regards,<br>Smart Patrolling System Team</p>
            </div>
            <div class="footer">
              <p>This is an automated message. Please do not reply to this email.</p>
              <p>&copy; 2024 Smart Patrolling System. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: `
        Welcome to Smart Patrolling System
        
        Hello ${name},
        
        Your account has been successfully created. Here are your login credentials:
        
        Username: ${username}
        Password: ${password}
        
        Please keep your credentials secure and change your password after first login.
        
        Best regards,
        Smart Patrolling System Team
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    return { success: false, error: error.message };
  }
};

// Send password reset email (optional for future use)
const sendPasswordResetEmail = async (userEmail, resetToken) => {
  try {
    const mailOptions = {
      from: `"Smart Patrolling System" <${EMAIL_CONFIG.auth.user}>`,
      to: userEmail,
      subject: 'Password Reset Request - Smart Patrolling System',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              line-height: 1.6;
              color: #333;
            }
            .container {
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
            }
            .button {
              display: inline-block;
              padding: 12px 24px;
              background-color: #007bff;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Password Reset Request</h2>
            <p>You have requested to reset your password. Click the button below to reset it:</p>
            <a href="${process.env.APP_URL}/reset-password?token=${resetToken}" class="button">Reset Password</a>
            <p>If you did not request this, please ignore this email.</p>
            <p>This link will expire in 1 hour.</p>
          </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendRegistrationEmail,
  sendPasswordResetEmail
};