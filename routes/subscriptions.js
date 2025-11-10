const express = require('express');
const crypto = require('crypto');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');
const { 
  sendSubscriptionSuccessEmail, 
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail 
} = require('../utils/email');

const router = express.Router();

// Initialize Razorpay only if credentials are available
let razorpay = null;

if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  const Razorpay = require('razorpay');
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
  console.log('Razorpay initialized for subscriptions');
} else {
  console.warn('Razorpay credentials not found. Payment features will be disabled.');
}

// @route   GET /api/subscriptions/plans
// @desc    Get all subscription plans
// @access  Private
router.get('/plans', protect, async (req, res) => {
  try {
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ price: 1 });
    res.json(plans);
  } catch (error) {
    console.error('Error fetching plans:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/subscriptions/create-order
// @desc    Create Razorpay order
// @access  Private
router.post('/create-order', protect, async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ 
        success: false,
        message: 'Payment service is not configured. Please contact support.' 
      });
    }

    console.log('Creating order for user:', req.user.id);
    const { planId, isUpgrade = false } = req.body;
    const user = await User.findById(req.user.id).populate('subscription.planId');
    const plan = await SubscriptionPlan.findById(planId);

    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    console.log('Plan found:', plan.name, 'Price:', plan.price);

    let finalAmount = plan.price * 100; // Convert to paise

    // Handle upgrade logic
    if (isUpgrade && user.subscription.status === 'active') {
      const upgradeCalculation = calculateUpgradeAmount(user, plan);
      if (upgradeCalculation.error) {
        return res.status(400).json({ message: upgradeCalculation.error });
      }
      finalAmount = upgradeCalculation.amount * 100;
      console.log('Upgrade amount calculated:', upgradeCalculation.amount);
    }

    // Create shorter receipt (max 40 chars)
    const timestamp = Date.now().toString().slice(-8); // Last 8 digits of timestamp
    const userIdShort = user._id.toString().slice(-6); // Last 6 chars of user ID
    const receipt = `rcpt_${timestamp}_${userIdShort}`; // Total: rcpt_12345678_abcdef = ~22 chars

    console.log('Creating Razorpay order with receipt:', receipt);

    // Create Razorpay order
    const options = {
      amount: finalAmount,
      currency: 'INR',
      receipt: receipt,
      notes: {
        userId: user._id.toString(),
        planId: planId,
        isUpgrade: isUpgrade.toString(),
        planName: plan.name
      }
    };

    const order = await razorpay.orders.create(options);
    console.log('Razorpay order created:', order.id);

    res.json({
      success: true,
      orderId: order.id,
      amount: finalAmount,
      currency: 'INR',
      key: process.env.RAZORPAY_KEY_ID,
      planName: plan.name,
      isUpgrade,
      receipt: receipt
    });
  } catch (error) {
    console.error('Error creating order:', error);
    
    // Handle Razorpay specific errors
    if (error.error && error.error.description) {
      return res.status(400).json({ 
        message: `Payment gateway error: ${error.error.description}`,
        details: error.error 
      });
    }
    
    res.status(500).json({ 
      message: 'Server error creating order',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Calculate upgrade amount with the specified algorithm
function calculateUpgradeAmount(user, newPlan) {
  try {
    const currentPlan = user.subscription.planId;
    const subscriptionStart = new Date(user.subscription.startDate);
    const now = new Date();
    const daysSinceSubscription = Math.floor((now - subscriptionStart) / (1000 * 60 * 60 * 24));
    
    // Check if current plan is basic and new plan is advance
    if (currentPlan.type !== 'basic' || newPlan.type !== 'advance') {
      return { error: 'Invalid upgrade path. Can only upgrade from Basic to Advance.' };
    }

    // Within 5 days - free upgrade (just pay difference)
    if (daysSinceSubscription <= 5) {
      const priceDifference = newPlan.price - currentPlan.price;
      return { 
        amount: Math.max(0, priceDifference),
        reason: 'Free upgrade within 5 days',
        daysSinceSubscription
      };
    }

    // After 5 days - different logic for monthly vs yearly
    if (currentPlan.billing === 'monthly') {
      // Monthly to any: charge one month of current plan + new plan price
      return {
        amount: currentPlan.price + newPlan.price,
        reason: 'Upgrade after 5 days: current month charge + new plan',
        daysSinceSubscription
      };
    } else {
      // Yearly to any: calculate used months and subtract from new plan
      const monthsUsed = Math.floor(daysSinceSubscription / 30);
      const monthlyEquivalent = currentPlan.price / 12;
      const usedAmount = monthsUsed * monthlyEquivalent;
      const refundableAmount = currentPlan.price - usedAmount;
      
      return {
        amount: Math.max(0, newPlan.price - refundableAmount),
        reason: `Yearly upgrade: used ${monthsUsed} months, refund applied`,
        daysSinceSubscription,
        usedAmount,
        refundableAmount
      };
    }
  } catch (error) {
    console.error('Error calculating upgrade amount:', error);
    return { error: 'Unable to calculate upgrade amount' };
  }
}

// @route   POST /api/subscriptions/verify-payment
// @desc    Verify Razorpay payment and activate subscription
// @access  Private
router.post('/verify-payment', protect, async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      planId
    } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    // Get user and plan
    const user = await User.findById(req.user.id);
    const plan = await SubscriptionPlan.findById(planId);

    if (!plan) {
      return res.status(404).json({ message: 'Plan not found' });
    }

    // Calculate subscription dates
    const startDate = new Date();
    const endDate = new Date(startDate);
    
    if (plan.billing === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Update user subscription
    user.subscription = {
      planId: plan._id,
      status: 'active',
      startDate,
      endDate,
      autoRenew: true,
      razorpaySubscriptionId: razorpay_payment_id
    };

    // Add to payment history
    user.paymentHistory.push({
      amount: plan.price,
      currency: 'INR',
      status: 'success',
      razorpayPaymentId: razorpay_payment_id,
      createdAt: new Date()
    });

    await user.save();

    // Send success email
    try {
      await sendSubscriptionSuccessEmail(user, user.subscription);
      console.log('✅ Subscription success email sent');
    } catch (emailError) {
      console.error('❌ Failed to send subscription email:', emailError.message);
    }

    res.json({
      success: true,
      message: 'Subscription activated successfully!',
      subscription: user.subscription
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    
    // Send payment failed email
    try {
      const plan = await SubscriptionPlan.findById(req.body.planId);
      if (plan) {
        await sendPaymentFailedEmail(user, plan.name, plan.price);
      }
    } catch (emailError) {
      console.error('Failed to send payment failed email:', emailError.message);
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Payment verification failed' 
    });
  }
});

// @route   POST /api/subscriptions/upgrade
// @desc    Upgrade subscription plan
// @access  Private
router.post('/upgrade', protect, async (req, res) => {
  try {
    const { newPlanId } = req.body;
    const user = await User.findById(req.user.id).populate('subscription.planId');
    const newPlan = await SubscriptionPlan.findById(newPlanId);

    if (user.subscription.status !== 'active') {
      return res.status(400).json({ message: 'No active subscription to upgrade' });
    }

    if (!newPlan) {
      return res.status(404).json({ message: 'New plan not found' });
    }

    const upgradeCalculation = calculateUpgradeAmount(user, newPlan);
    
    if (upgradeCalculation.error) {
      return res.status(400).json({ message: upgradeCalculation.error });
    }

    res.json({
      canUpgrade: true,
      upgradeAmount: upgradeCalculation.amount,
      reason: upgradeCalculation.reason,
      daysSinceSubscription: upgradeCalculation.daysSinceSubscription,
      newPlan: {
        name: newPlan.name,
        price: newPlan.price,
        features: newPlan.features
      }
    });
  } catch (error) {
    console.error('Error calculating upgrade:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/subscriptions/cancel
// @desc    Cancel subscription (keeps access until end date)
// @access  Private
router.post('/cancel', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('subscription.planId');

    if (!user.subscription || user.subscription.status !== 'active') {
      return res.status(400).json({ 
        success: false,
        message: 'No active subscription to cancel' 
      });
    }

    // Update subscription status to cancelled but keep end date
    user.subscription.status = 'cancelled';
    user.subscription.autoRenew = false;
    
    // Add cancellation record to payment history
    user.paymentHistory.push({
      amount: 0,
      currency: 'INR',
      status: 'cancelled',
      razorpayPaymentId: `cancel_${Date.now()}`,
      createdAt: new Date()
    });

    await user.save();

    // Send cancellation email
    try {
      await sendSubscriptionCancelledEmail(user, user.subscription.endDate);
      console.log('✅ Cancellation email sent');
    } catch (emailError) {
      console.error('❌ Failed to send cancellation email:', emailError.message);
    }

    res.json({
      success: true,
      message: 'Subscription cancelled successfully. You can continue using the service until the end of your billing period.',
      endDate: user.subscription.endDate
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

// @route   POST /api/subscriptions/reactivate
// @desc    Reactivate a cancelled subscription
// @access  Private
router.post('/reactivate', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('subscription.planId');

    if (!user.subscription || user.subscription.status !== 'cancelled') {
      return res.status(400).json({ 
        success: false,
        message: 'No cancelled subscription to reactivate' 
      });
    }

    // Check if subscription is still within the valid period
    const now = new Date();
    const endDate = new Date(user.subscription.endDate);
    
    if (now > endDate) {
      return res.status(400).json({
        success: false,
        message: 'Subscription period has expired. Please subscribe to a new plan.'
      });
    }

    // Reactivate subscription
    user.subscription.status = 'active';
    user.subscription.autoRenew = true;
    
    await user.save();

    res.json({
      success: true,
      message: 'Subscription reactivated successfully',
      subscription: user.subscription
    });
  } catch (error) {
    console.error('Error reactivating subscription:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while reactivating subscription' 
    });
  }
});

// @route   POST /api/subscriptions/check-renewals
// @desc    Manually trigger subscription renewal check (Admin only)
// @access  Admin
router.post('/check-renewals', protect, adminOnly, async (req, res) => {
  try {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const expiringSubscriptions = await User.find({
      'subscription.status': 'active',
      'subscription.autoRenew': true,
      'subscription.endDate': {
        $gte: now,
        $lt: tomorrow
      }
    }).populate('subscription.planId');

    res.json({
      success: true,
      message: `Found ${expiringSubscriptions.length} subscriptions to renew`,
      subscriptions: expiringSubscriptions.map(u => ({
        email: u.email,
        plan: u.subscription.planId?.name,
        endDate: u.subscription.endDate
      }))
    });
  } catch (error) {
    console.error('Check renewals error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

// @route   GET /api/subscriptions/my-subscription
// @desc    Get current user's subscription details
// @access  Private
router.get('/my-subscription', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('subscription.planId')
      .select('-password');

    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'User not found' 
      });
    }

    const subscription = {
      status: user.subscription.status,
      plan: user.subscription.planId,
      startDate: user.subscription.startDate,
      endDate: user.subscription.endDate,
      autoRenew: user.subscription.autoRenew,
      daysRemaining: user.subscription.endDate 
        ? Math.ceil((new Date(user.subscription.endDate) - new Date()) / (1000 * 60 * 60 * 24))
        : 0
    };

    res.json({
      success: true,
      subscription
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error' 
    });
  }
});

module.exports = router;
