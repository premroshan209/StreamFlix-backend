const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { cloudinary } = require('../utils/cloudinary');
const multer = require('multer');

const router = express.Router();

// ✅ Use memory storage for serverless (no disk writes)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// @route   GET /api/users/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('subscription.planId')
      .select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ 
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        subscription: user.subscription,
        profiles: user.profiles,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/users/profile
// @desc    Create new profile
// @access  Private
router.post('/profile', protect, [
  body('name').notEmpty().withMessage('Profile name is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, preferences } = req.body;
    const user = await User.findById(req.user.id);

    if (user.profiles.length >= 5) {
      return res.status(400).json({ message: 'Maximum 5 profiles allowed' });
    }

    const newProfile = {
      name,
      preferences: preferences || { genres: [], language: 'en' },
      watchHistory: [],
      watchlist: []
    };

    user.profiles.push(newProfile);
    await user.save();

    res.status(201).json({
      message: 'Profile created successfully',
      profile: user.profiles[user.profiles.length - 1]
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/profile/:profileId
// @desc    Update profile
// @access  Private
router.put('/profile/:profileId', protect, upload.single('avatar'), async (req, res) => {
  try {
    const { name, preferences } = req.body;
    const user = await User.findById(req.user.id);
    const profile = user.profiles.id(req.params.profileId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    if (name) profile.name = name;
    if (preferences) profile.preferences = JSON.parse(preferences);

    // ✅ Upload directly from memory buffer to Cloudinary
    if (req.file) {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'streamflix/avatars',
        resource_type: 'auto'
      });
      
      profile.avatar = result.secure_url;
    }

    await user.save();

    res.json({
      message: 'Profile updated successfully',
      profile
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/users/profile/:profileId
// @desc    Delete profile
// @access  Private
router.delete('/profile/:profileId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (user.profiles.length <= 1) {
      return res.status(400).json({ message: 'Cannot delete the last profile' });
    }

    user.profiles.id(req.params.profileId).remove();
    await user.save();

    res.json({ message: 'Profile deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/profile/:profileId/watchlist
// @desc    Get profile watchlist
// @access  Private
router.get('/profile/:profileId/watchlist', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: 'profiles.watchlist',
      model: 'Video'
    });
    
    const profile = user.profiles.id(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.json(profile.watchlist);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/users/profile/:profileId/history
// @desc    Get watch history
// @access  Private
router.get('/profile/:profileId/history', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate({
      path: 'profiles.watchHistory.videoId',
      model: 'Video'
    });
    
    const profile = user.profiles.id(req.params.profileId);
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    res.json(profile.watchHistory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/users/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, age, gender, preferences } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update user name
    if (name) {
      user.name = name;
    }

    // Update profile (use first profile or create if none exists)
    if (user.profiles.length === 0) {
      user.profiles.push({
        name: name || user.name,
        avatar: '',
        preferences: { genres: [], language: 'en' }
      });
    }

    const profile = user.profiles[0];
    
    if (name) profile.name = name;
    if (age !== undefined) profile.age = age;
    if (gender) profile.gender = gender;
    if (preferences) {
      if (preferences.genres) profile.preferences.genres = preferences.genres;
      if (preferences.language) profile.preferences.language = preferences.language;
    }

    await user.save();

    // Return updated user without password
    const updatedUser = await User.findById(req.user.id)
      .populate('subscription.planId')
      .select('-password');

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Server error updating profile' 
    });
  }
});

module.exports = router;
