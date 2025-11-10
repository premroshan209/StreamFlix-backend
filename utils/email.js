const nodemailer = require('nodemailer');

// Create reusable transporter
const createTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.warn('⚠️  Email credentials not configured');
    return null;
  }

  return nodemailer.createTransporter({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
    tls: {
      rejectUnauthorized: false // For development
    }
  });
};

// Send email function
const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const transporter = createTransporter();
    
    if (!transporter) {
      console.warn('Email service not configured. Email not sent.');
      return { messageId: 'test-' + Date.now(), skipped: true };
    }

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'StreamFlix'}" <${process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER}>`,
      to,
      subject,
      text: text || subject,
      html: html || `<p>${text || subject}</p>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email sent successfully:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    throw error;
  }
};

// Email templates
const emailTemplates = {
  welcome: (userName, verificationUrl) => ({
    subject: 'Welcome to StreamFlix! 🎬',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #e50914, #f40612); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #e50914; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎬 Welcome to StreamFlix!</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName}! 👋</h2>
            <p>Thank you for joining StreamFlix - your premium streaming destination!</p>
            <p>Please verify your email address to get started:</p>
            <p style="text-align: center;">
              <a href="${verificationUrl}" class="button">Verify Email Address</a>
            </p>
            <p><strong>What's Next?</strong></p>
            <ul>
              <li>✅ Verify your email</li>
              <li>🎭 Create your profiles</li>
              <li>💳 Choose a subscription plan</li>
              <li>🎬 Start streaming unlimited content!</li>
            </ul>
            <p>If you didn't create this account, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>© 2024 StreamFlix. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  subscriptionSuccess: (userName, planName, amount, endDate) => ({
    subject: '🎉 Subscription Activated - StreamFlix',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #4CAF50, #45a049); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .details { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
          .detail-row:last-child { border-bottom: none; }
          .button { display: inline-block; background: #e50914; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to StreamFlix Premium!</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName}!</h2>
            <p>Your subscription has been activated successfully. Get ready for unlimited entertainment!</p>
            
            <div class="details">
              <h3>Subscription Details:</h3>
              <div class="detail-row">
                <span><strong>Plan:</strong></span>
                <span>${planName}</span>
              </div>
              <div class="detail-row">
                <span><strong>Amount Paid:</strong></span>
                <span>₹${amount}</span>
              </div>
              <div class="detail-row">
                <span><strong>Valid Until:</strong></span>
                <span>${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
              </div>
              <div class="detail-row">
                <span><strong>Status:</strong></span>
                <span style="color: #4CAF50;">✅ Active</span>
              </div>
            </div>

            <p><strong>What's Included:</strong></p>
            <ul>
              <li>🎬 Unlimited movies and TV shows</li>
              <li>📱 Watch on any device</li>
              <li>👥 Multiple user profiles</li>
              <li>💾 Download and watch offline</li>
              <li>🎯 Personalized recommendations</li>
            </ul>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/profiles" class="button">Start Watching Now</a>
            </p>
          </div>
          <div class="footer">
            <p>© 2024 StreamFlix. All rights reserved.</p>
            <p>Need help? Contact us at ${process.env.EMAIL_FROM_ADDRESS}</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  subscriptionCancelled: (userName, endDate) => ({
    subject: 'Subscription Cancelled - StreamFlix',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #ff9800, #f57c00); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .info-box { background: #fff3cd; border-left: 4px solid #ff9800; padding: 15px; margin: 20px 0; }
          .button { display: inline-block; background: #e50914; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Subscription Cancelled</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName},</h2>
            <p>We're sorry to see you go! Your subscription has been cancelled.</p>
            
            <div class="info-box">
              <p><strong>⚠️ Important Information:</strong></p>
              <p>You can continue to enjoy StreamFlix until <strong>${new Date(endDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong></p>
              <p>After this date, your access to premium content will be limited.</p>
            </div>

            <p><strong>What You'll Lose:</strong></p>
            <ul>
              <li>Access to premium movies and TV shows</li>
              <li>HD/4K streaming quality</li>
              <li>Multiple device support</li>
              <li>Offline downloads</li>
            </ul>

            <p><strong>Changed Your Mind?</strong></p>
            <p>You can reactivate your subscription anytime before ${new Date(endDate).toLocaleDateString()}!</p>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription" class="button">Reactivate Subscription</a>
            </p>

            <p>We'd love to have you back! If there's anything we can do to improve your experience, please let us know.</p>
          </div>
          <div class="footer">
            <p>© 2024 StreamFlix. All rights reserved.</p>
            <p>Questions? Reply to this email or visit our help center.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  passwordReset: (userName, resetUrl) => ({
    subject: 'Reset Your Password - StreamFlix',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #e50914, #f40612); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #e50914; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🔒 Password Reset Request</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName},</h2>
            <p>We received a request to reset your StreamFlix password.</p>
            <p>Click the button below to create a new password:</p>
            
            <p style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>

            <div class="warning">
              <p><strong>⚠️ Security Notice:</strong></p>
              <ul style="margin: 10px 0;">
                <li>This link expires in 10 minutes</li>
                <li>If you didn't request this, please ignore this email</li>
                <li>Your password won't change until you create a new one</li>
              </ul>
            </div>

            <p>For security reasons, this link can only be used once.</p>
            <p>If the button doesn't work, copy and paste this link:</p>
            <p style="word-break: break-all; color: #666;">${resetUrl}</p>
          </div>
          <div class="footer">
            <p>© 2024 StreamFlix. All rights reserved.</p>
            <p>Didn't request this? Contact support immediately.</p>
          </div>
        </div>
      </body>
      </html>
    `
  }),

  paymentFailed: (userName, planName, amount) => ({
    subject: 'Payment Failed - StreamFlix',
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #f44336, #e53935); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .button { display: inline-block; background: #e50914; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
          .error-box { background: #ffebee; border-left: 4px solid #f44336; padding: 15px; margin: 20px 0; }
          .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>❌ Payment Failed</h1>
          </div>
          <div class="content">
            <h2>Hello ${userName},</h2>
            <p>We were unable to process your payment for StreamFlix subscription.</p>
            
            <div class="error-box">
              <p><strong>Payment Details:</strong></p>
              <p>Plan: ${planName}</p>
              <p>Amount: ₹${amount}</p>
              <p>Status: Failed</p>
            </div>

            <p><strong>What you can do:</strong></p>
            <ul>
              <li>Check if your payment method is valid</li>
              <li>Ensure you have sufficient balance</li>
              <li>Try a different payment method</li>
              <li>Contact your bank if the issue persists</li>
            </ul>

            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription" class="button">Try Again</a>
            </p>

            <p>Need help? Our support team is here to assist you!</p>
          </div>
          <div class="footer">
            <p>© 2024 StreamFlix. All rights reserved.</p>
            <p>Contact support: ${process.env.EMAIL_FROM_ADDRESS}</p>
          </div>
        </div>
      </body>
      </html>
    `
  })
};

// Helper functions to send specific emails
const sendWelcomeEmail = async (user, verificationToken) => {
  const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${verificationToken}`;
  const template = emailTemplates.welcome(user.name, verificationUrl);
  return sendEmail({ to: user.email, ...template });
};

const sendSubscriptionSuccessEmail = async (user, subscription) => {
  const template = emailTemplates.subscriptionSuccess(
    user.name,
    subscription.planId.name,
    subscription.planId.price,
    subscription.endDate
  );
  return sendEmail({ to: user.email, ...template });
};

const sendSubscriptionCancelledEmail = async (user, endDate) => {
  const template = emailTemplates.subscriptionCancelled(user.name, endDate);
  return sendEmail({ to: user.email, ...template });
};

const sendPasswordResetEmail = async (user, resetToken) => {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;
  const template = emailTemplates.passwordReset(user.name, resetUrl);
  return sendEmail({ to: user.email, ...template });
};

const sendPaymentFailedEmail = async (user, planName, amount) => {
  const template = emailTemplates.paymentFailed(user.name, planName, amount);
  return sendEmail({ to: user.email, ...template });
};

module.exports = {
  sendEmail,
  emailTemplates,
  sendWelcomeEmail,
  sendSubscriptionSuccessEmail,
  sendSubscriptionCancelledEmail,
  sendPasswordResetEmail,
  sendPaymentFailedEmail
};
