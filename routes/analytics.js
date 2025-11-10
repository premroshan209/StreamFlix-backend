const express = require('express');
const User = require('../models/User');
const Video = require('../models/Video');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/analytics/user-growth
// @desc    Get user growth analytics
// @access  Admin
router.get('/user-growth', protect, adminOnly, async (req, res) => {
  try {
    const { period = '12months' } = req.query;
    
    let dateFilter = {};
    if (period === '30days') {
      dateFilter = {
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      };
    } else if (period === '12months') {
      dateFilter = {
        createdAt: { $gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) }
      };
    }

    const userGrowth = await User.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json(userGrowth);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/analytics/revenue
// @desc    Get revenue analytics
// @access  Admin
router.get('/revenue', protect, adminOnly, async (req, res) => {
  try {
    const revenueData = await User.aggregate([
      { $unwind: '$paymentHistory' },
      { $match: { 'paymentHistory.status': 'success' } },
      {
        $group: {
          _id: {
            year: { $year: '$paymentHistory.createdAt' },
            month: { $month: '$paymentHistory.createdAt' }
          },
          revenue: { $sum: '$paymentHistory.amount' },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    res.json(revenueData);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/analytics/content-performance
// @desc    Get content performance analytics
// @access  Admin
router.get('/content-performance', protect, adminOnly, async (req, res) => {
  try {
    const topVideos = await Video.find()
      .select('title views likes genre type createdAt')
      .sort({ views: -1 })
      .limit(20);

    const genrePerformance = await Video.aggregate([
      { $unwind: '$genre' },
      {
        $group: {
          _id: '$genre',
          totalViews: { $sum: '$views' },
          totalVideos: { $sum: 1 },
          avgViews: { $avg: '$views' }
        }
      },
      { $sort: { totalViews: -1 } }
    ]);

    const typePerformance = await Video.aggregate([
      {
        $group: {
          _id: '$type',
          totalViews: { $sum: '$views' },
          totalVideos: { $sum: 1 },
          avgViews: { $avg: '$views' }
        }
      }
    ]);

    res.json({
      topVideos,
      genrePerformance,
      typePerformance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/analytics/subscription-metrics
// @desc    Get subscription metrics
// @access  Admin
router.get('/subscription-metrics', protect, adminOnly, async (req, res) => {
  try {
    const subscriptionStats = await User.aggregate([
      {
        $group: {
          _id: '$subscription.status',
          count: { $sum: 1 }
        }
      }
    ]);

    const planDistribution = await User.aggregate([
      { $match: { 'subscription.status': 'active' } },
      {
        $lookup: {
          from: 'subscriptionplans',
          localField: 'subscription.planId',
          foreignField: '_id',
          as: 'plan'
        }
      },
      { $unwind: '$plan' },
      {
        $group: {
          _id: '$plan.name',
          count: { $sum: 1 },
          revenue: { $sum: '$plan.price' }
        }
      }
    ]);

    const churnRate = await User.aggregate([
      {
        $match: {
          'subscription.status': 'cancelled',
          'subscription.endDate': {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          }
        }
      },
      { $count: 'cancelled' }
    ]);

    res.json({
      subscriptionStats,
      planDistribution,
      churnRate: churnRate[0]?.cancelled || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
