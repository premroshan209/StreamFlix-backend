const cron = require('node-cron');
const User = require('../models/User');
const SubscriptionPlan = require('../models/SubscriptionPlan');

// Initialize Razorpay only if credentials are available
let razorpay = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
  console.log('Razorpay initialized for subscription cron');
} else {
  console.warn('Razorpay credentials not found. Subscription auto-renewal will be disabled.');
}

// Check and process subscription renewals every day at 2 AM
const subscriptionRenewalCron = cron.schedule('0 2 * * *', async () => {
  console.log('Running subscription renewal check...');
  
  if (!razorpay) {
    console.warn('Razorpay not configured. Skipping renewal check.');
    return;
  }
  
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Find subscriptions expiring in the next 24 hours with auto-renew enabled
    const expiringSubscriptions = await User.find({
      'subscription.status': 'active',
      'subscription.autoRenew': true,
      'subscription.endDate': {
        $gte: now,
        $lt: tomorrow
      }
    }).populate('subscription.planId');

    console.log(`Found ${expiringSubscriptions.length} subscriptions to renew`);

    for (const user of expiringSubscriptions) {
      try {
        const plan = user.subscription.planId;
        
        if (!plan) {
          console.log(`No plan found for user ${user.email}, skipping`);
          continue;
        }

        console.log(`Processing renewal for ${user.email} - Plan: ${plan.name}`);
        
        // Send renewal notification email (implement email service)
        await sendRenewalNotification(user, plan);
        
        // Update subscription dates for next billing cycle
        const startDate = new Date(user.subscription.endDate);
        const endDate = new Date(startDate);
        
        if (plan.billing === 'monthly') {
          endDate.setMonth(endDate.getMonth() + 1);
        } else {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
        
        user.subscription.startDate = startDate;
        user.subscription.endDate = endDate;
        
        await user.save();
        
        console.log(`Renewed subscription for ${user.email} until ${endDate}`);
        
      } catch (error) {
        console.error(`Error renewing subscription for ${user.email}:`, error);
        
        // If renewal fails, mark subscription for review
        user.subscription.status = 'expired';
        await user.save();
      }
    }
    
  } catch (error) {
    console.error('Subscription renewal cron error:', error);
  }
}, {
  scheduled: false // Don't start automatically
});

// Check for expired subscriptions every 6 hours
const expiredSubscriptionsCron = cron.schedule('0 */6 * * *', async () => {
  console.log('Checking for expired subscriptions...');
  
  try {
    const now = new Date();
    
    // Find active subscriptions that have passed their end date
    const expiredSubscriptions = await User.find({
      'subscription.status': 'active',
      'subscription.endDate': { $lt: now }
    });

    console.log(`Found ${expiredSubscriptions.length} expired subscriptions`);

    for (const user of expiredSubscriptions) {
      user.subscription.status = 'expired';
      await user.save();
      
      console.log(`Marked subscription as expired for ${user.email}`);
      
      // Send expiration notification
      await sendExpirationNotification(user);
    }
    
  } catch (error) {
    console.error('Expired subscriptions cron error:', error);
  }
}, {
  scheduled: false // Don't start automatically
});

// Helper function to send renewal notification
async function sendRenewalNotification(user, plan) {
  // TODO: Implement email service (SendGrid, Nodemailer, etc.)
  console.log(`Sending renewal notification to ${user.email} for ${plan.name}`);
  
  // Example email content:
  const emailContent = {
    to: user.email,
    subject: 'StreamFlix - Subscription Renewal',
    text: `Your ${plan.name} subscription has been renewed. Next billing date: ${user.subscription.endDate}`,
    html: `
      <h2>Subscription Renewed</h2>
      <p>Hello ${user.name},</p>
      <p>Your ${plan.name} subscription has been successfully renewed.</p>
      <p><strong>Amount:</strong> ₹${plan.price}</p>
      <p><strong>Next Billing Date:</strong> ${new Date(user.subscription.endDate).toLocaleDateString()}</p>
      <p>Thank you for being a valued subscriber!</p>
    `
  };
  
  // Send email using your email service
  // await emailService.send(emailContent);
}

// Helper function to send expiration notification
async function sendExpirationNotification(user) {
  console.log(`Sending expiration notification to ${user.email}`);
  
  const emailContent = {
    to: user.email,
    subject: 'StreamFlix - Subscription Expired',
    text: `Your subscription has expired. Renew now to continue streaming.`,
    html: `
      <h2>Subscription Expired</h2>
      <p>Hello ${user.name},</p>
      <p>Your subscription has expired. Renew now to continue enjoying unlimited streaming.</p>
      <p><a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription">View Subscription Plans</a></p>
    `
  };
  
  // Send email using your email service
  // await emailService.send(emailContent);
}

// Start cron jobs
function startSubscriptionCrons() {
  // ❌ NEVER run cron jobs in Vercel serverless
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    console.log('⚠️  Cron jobs disabled in serverless (Vercel)');
    console.log('💡 Use Vercel Cron Jobs or external scheduler');
    return;
  }
  
  // Only for local development
  subscriptionRenewalCron.start();
  expiredSubscriptionsCron.start();
  console.log('✅ Cron jobs started (local)');
}

// Stop cron jobs
function stopSubscriptionCrons() {
  subscriptionRenewalCron.stop();
  expiredSubscriptionsCron.stop();
  console.log('Subscription cron jobs stopped');
}

module.exports = {
  startSubscriptionCrons,
  stopSubscriptionCrons,
  subscriptionRenewalCron,
  expiredSubscriptionsCron
};
