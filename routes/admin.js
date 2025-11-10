const express = require('express');
const User = require('../models/User');
const Video = require('../models/Video');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard data
// @access  Admin
router.get('/dashboard', protect, adminOnly, async (req, res) => {
  try {
    // Get basic stats
    const totalUsers = await User.countDocuments();
    const activeSubscriptions = await User.countDocuments({
      'subscription.status': 'active'
    });
    const totalVideos = await Video.countDocuments({ isActive: true });
    
    // Calculate total revenue
    const revenueData = await User.aggregate([
      { $unwind: '$paymentHistory' },
      { $match: { 'paymentHistory.status': 'success' } },
      { $group: { _id: null, total: { $sum: '$paymentHistory.amount' } } }
    ]);
    const totalRevenue = revenueData[0]?.total || 0;

    // Recent users (last 10)
    const recentUsers = await User.find()
      .select('name email createdAt subscription.status')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Most watched videos
    const popularVideos = await Video.find({ isActive: true })
      .select('title views genre type')
      .sort({ views: -1 })
      .limit(10)
      .lean();

    // Monthly revenue trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await User.aggregate([
      { $unwind: '$paymentHistory' },
      { 
        $match: { 
          'paymentHistory.status': 'success',
          'paymentHistory.createdAt': { $gte: sixMonthsAgo }
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: '$paymentHistory.createdAt' },
            month: { $month: '$paymentHistory.createdAt' }
          },
          revenue: { $sum: '$paymentHistory.amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    // User growth trend (last 6 months)
    const userGrowth = await User.aggregate([
      { 
        $match: { 
          createdAt: { $gte: sixMonthsAgo }
        } 
      },
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

    // Subscription distribution
    const subscriptionStats = await User.aggregate([
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

    res.json({
      stats: {
        totalUsers,
        activeSubscriptions,
        totalVideos,
        totalRevenue
      },
      recentUsers,
      popularVideos,
      monthlyRevenue,
      userGrowth,
      subscriptionStats
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ message: 'Server error while fetching dashboard data' });
  }
});

// @route   GET /api/admin/users
// @desc    Get all users with pagination
// @access  Admin
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const filter = {};
    if (req.query.status) {
      filter['subscription.status'] = req.query.status;
    }
    if (req.query.search) {
      filter.$or = [
        { name: { $regex: req.query.search, $options: 'i' } },
        { email: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .populate('subscription.planId', 'name price type')
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    const total = await User.countDocuments(filter);

    res.json({
      users,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalUsers: total
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/admin/videos
// @desc    Get all videos with pagination and filters
// @access  Admin
router.get('/videos', protect, adminOnly, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const filter = {};
    
    // By default, only show active videos unless specifically requested
    if (req.query.showInactive !== 'true') {
      filter.isActive = true;
    }
    
    // Add search filter
    if (req.query.search) {
      filter.$or = [
        { title: { $regex: req.query.search, $options: 'i' } },
        { description: { $regex: req.query.search, $options: 'i' } },
        { 'cast.name': { $regex: req.query.search, $options: 'i' } },
        { director: { $regex: req.query.search, $options: 'i' } }
      ];
    }
    
    // Add type filter
    if (req.query.type) {
      filter.type = req.query.type;
    }
    
    // Add status filter - override default isActive filter
    if (req.query.status === 'active') {
      filter.isActive = true;
    } else if (req.query.status === 'inactive') {
      filter.isActive = false;
    }

    console.log('Videos filter:', filter); // Debug log

    const videos = await Video.find(filter)
      .populate('uploadedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await Video.countDocuments(filter);

    console.log(`Found ${videos.length} videos, total: ${total}`); // Debug log

    res.json({
      success: true,
      videos,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalVideos: total,
      hasMore: page < Math.ceil(total / limit)
    });
  } catch (error) {
    console.error('Get videos error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching videos' 
    });
  }
});

// @route   GET /api/admin/videos/:id
// @desc    Get single video details for editing
// @access  Admin
router.get('/videos/:id', protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .populate('uploadedBy', 'name email');
    
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: 'Video not found' 
      });
    }

    res.json({
      success: true,
      video
    });
  } catch (error) {
    console.error('Get video error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while fetching video' 
    });
  }
});

// @route   PUT /api/admin/videos/:id
// @desc    Update video details
// @access  Admin
router.put('/videos/:id', protect, adminOnly, async (req, res) => {
  try {
    const { title, description, genre, type, releaseYear, rating, imdbRating, director, producer, language, tags, isActive } = req.body;
    
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: 'Video not found' 
      });
    }

    // Update video fields
    if (title) video.title = title;
    if (description) video.description = description;
    if (genre) video.genre = Array.isArray(genre) ? genre : JSON.parse(genre);
    if (type) video.type = type;
    if (releaseYear) video.releaseYear = parseInt(releaseYear);
    if (rating) video.rating = rating;
    if (imdbRating) video.imdbRating = parseFloat(imdbRating);
    if (director) video.director = director;
    if (producer) video.producer = producer;
    if (language) video.language = language;
    if (tags) video.tags = Array.isArray(tags) ? tags : JSON.parse(tags);
    if (isActive !== undefined) video.isActive = isActive;

    await video.save();

    res.json({
      success: true,
      message: 'Video updated successfully',
      video
    });
  } catch (error) {
    console.error('Update video error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while updating video' 
    });
  }
});

// @route   DELETE /api/admin/videos/:id
// @desc    Delete/deactivate video (soft delete)
// @access  Admin
router.delete('/videos/:id', protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: 'Video not found' 
      });
    }

    // Soft delete by setting isActive to false
    video.isActive = false;
    await video.save();

    console.log(`Video ${video._id} marked as inactive`); // Debug log

    res.json({
      success: true,
      message: 'Video deleted successfully (marked as inactive)',
      videoId: video._id
    });
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while deleting video' 
    });
  }
});

// @route   DELETE /api/admin/videos/:id/permanent
// @desc    Permanently delete video
// @access  Admin
router.delete('/videos/:id/permanent', protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: 'Video not found' 
      });
    }

    // Permanently delete from database
    await Video.findByIdAndDelete(req.params.id);

    console.log(`Video ${video._id} permanently deleted`); // Debug log

    res.json({
      success: true,
      message: 'Video permanently deleted',
      videoId: video._id
    });
  } catch (error) {
    console.error('Permanent delete video error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while permanently deleting video' 
    });
  }
});

// @route   POST /api/admin/videos/:id/toggle-status
// @desc    Toggle video active status
// @access  Admin
router.post('/videos/:id/toggle-status', protect, adminOnly, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ 
        success: false,
        message: 'Video not found' 
      });
    }

    video.isActive = !video.isActive;
    await video.save();

    res.json({
      success: true,
      message: `Video ${video.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: video.isActive
    });
  } catch (error) {
    console.error('Toggle video status error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error while toggling video status' 
    });
  }
});

// @route   GET /api/admin/analytics
// @desc    Get analytics data
// @access  Admin
router.get('/analytics', protect, adminOnly, async (req, res) => {
  try {
    const { period = '30' } = req.query;
    const daysBack = parseInt(period);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Daily user registrations
    const userRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            day: { $dayOfMonth: '$createdAt' }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Daily revenue
    const dailyRevenue = await User.aggregate([
      { $unwind: '$paymentHistory' },
      { 
        $match: { 
          'paymentHistory.status': 'success',
          'paymentHistory.createdAt': { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            year: { $year: '$paymentHistory.createdAt' },
            month: { $month: '$paymentHistory.createdAt' },
            day: { $dayOfMonth: '$paymentHistory.createdAt' }
          },
          revenue: { $sum: '$paymentHistory.amount' },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    // Top performing content
    const topContent = await Video.find({ isActive: true })
      .select('title views likes genre type')
      .sort({ views: -1 })
      .limit(10);

    res.json({
      userRegistrations,
      dailyRevenue,
      topContent,
      period: daysBack
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
