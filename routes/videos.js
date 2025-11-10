const express = require('express');
const multer = require('multer');
const { cloudinary } = require('../utils/cloudinary');
const Video = require('../models/Video');
const User = require('../models/User');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

const upload = multer({ dest: 'uploads/' });

// Middleware to check subscription
const checkSubscription = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if user has active subscription
    if (user.subscription.status !== 'active') {
      return res.status(403).json({ 
        message: 'Active subscription required to watch videos',
        requiresSubscription: true
      });
    }

    // Check if subscription has expired
    if (user.subscription.endDate && new Date(user.subscription.endDate) < new Date()) {
      user.subscription.status = 'expired';
      await user.save();
      
      return res.status(403).json({ 
        message: 'Your subscription has expired. Please renew to continue watching.',
        requiresSubscription: true
      });
    }

    next();
  } catch (error) {
    console.error('Subscription check error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @route   POST /api/videos/fix-indexes
// @desc    Fix database text indexes (for development)
// @access  Admin
router.post('/fix-indexes', protect, adminOnly, async (req, res) => {
  try {
    const Video = require('../models/Video');
    
    // Drop all indexes except _id
    await Video.collection.dropIndexes();
    console.log('Dropped all indexes');
    
    // Create new text index without language restrictions
    await Video.collection.createIndex(
      { 
        title: 'text', 
        description: 'text', 
        genre: 'text',
        tags: 'text'
      },
      { 
        default_language: 'none',
        name: 'video_text_index'
      }
    );
    console.log('Created new text index');
    
    res.json({ 
      success: true,
      message: 'Database indexes fixed successfully' 
    });
  } catch (error) {
    console.error('Fix indexes error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fix indexes',
      error: error.message 
    });
  }
});

// @route   GET /api/videos
// @desc    Get all videos with pagination and filters
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const filter = { isActive: true };
    
    // Add filters
    if (req.query.genre) {
      filter.genre = { $in: [req.query.genre] };
    }
    if (req.query.type) {
      filter.type = req.query.type;
    }
    if (req.query.year) {
      filter.releaseYear = parseInt(req.query.year);
    }
    if (req.query.search) {
      // Enhanced search with multiple fields
      const searchRegex = new RegExp(req.query.search, 'i');
      filter.$or = [
        { title: searchRegex },
        { description: searchRegex },
        { genre: { $in: [searchRegex] } },
        { tags: { $in: [searchRegex] } },
        { director: searchRegex },
        { cast: { $elemMatch: { name: searchRegex } } }
      ];
    }

    const videos = await Video.find(filter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    const total = await Video.countDocuments(filter);

    res.json({
      videos,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalVideos: total
    });
  } catch (error) {
    console.error('Search videos error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/videos/featured
// @desc    Get featured videos
// @access  Private
router.get('/featured', protect, async (req, res) => {
  try {
    const videos = await Video.find({ isActive: true })
      .sort({ views: -1, createdAt: -1 })
      .limit(10)
      .populate('uploadedBy', 'name');
    
    res.json(videos);
  } catch (error) {
    console.error('Featured videos error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/videos/recommendations
// @desc    Get personalized recommendations
// @access  Private
router.get('/recommendations', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    const { profileId } = req.query;
    
    let profile = user.profiles.id(profileId);
    if (!profile) {
      profile = user.profiles[0];
    }

    // Get recommendations based on watch history and preferences
    let filter = { isActive: true };
    
    if (profile && profile.preferences.genres.length > 0) {
      filter.genre = { $in: profile.preferences.genres };
    }

    // Exclude already watched videos
    const watchedVideoIds = profile?.watchHistory?.map(item => item.videoId) || [];
    if (watchedVideoIds.length > 0) {
      filter._id = { $nin: watchedVideoIds };
    }

    const recommendations = await Video.find(filter)
      .sort({ views: -1, imdbRating: -1 })
      .limit(20)
      .populate('uploadedBy', 'name');

    res.json(recommendations);
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/videos/:id
// @desc    Get single video (with subscription check for playback)
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id).populate('uploadedBy', 'name');
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    // Don't increment view count if just viewing details
    // Only increment when actually playing
    if (req.query.playback === 'true') {
      // Check subscription for playback
      const user = await User.findById(req.user.id);
      if (user.subscription.status !== 'active') {
        return res.status(403).json({ 
          message: 'Active subscription required to watch videos',
          requiresSubscription: true
        });
      }
      
      video.views += 1;
      await video.save();
    }

    res.json(video);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/videos/upload
// @desc    Upload new video (movie or series with episodes)
// @access  Admin
router.post('/upload', protect, adminOnly, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'trailer', maxCount: 1 },
  { name: 'episodes', maxCount: 50 } // Support multiple episode files
]), async (req, res) => {
  let videoResult, thumbnailResult, trailerResult;
  let episodeResults = [];
  
  try {
    console.log('Upload request received');
    console.log('Body:', req.body);
    console.log('Files:', req.files);

    const {
      title, description, genre, type, releaseYear, duration,
      rating, imdbRating, cast, director, producer, language, subtitles, tags,
      seasonNumber, episodeData // For series
    } = req.body;

    // Validate required fields
    if (!title || !description || !type) {
      return res.status(400).json({ message: 'Title, description, and type are required' });
    }

    // Validate required files based on type
    if (type === 'movie') {
      if (!req.files || !req.files.video || !req.files.thumbnail) {
        return res.status(400).json({ message: 'Video and thumbnail files are required for movies' });
      }
    } else if (type === 'series') {
      if (!req.files || !req.files.thumbnail) {
        return res.status(400).json({ message: 'Thumbnail is required for series' });
      }
      if (!episodeData) {
        return res.status(400).json({ message: 'Episode data is required for series' });
      }
    }

    console.log('Starting file uploads to Cloudinary...');

    // Upload main video (for movies) or first episode (for series)
    if (req.files.video && req.files.video[0]) {
      videoResult = await cloudinary.uploader.upload(req.files.video[0].path, {
        resource_type: 'video',
        folder: 'streamflix/videos',
        use_filename: true,
        unique_filename: false
      });
      console.log('Main video uploaded to Cloudinary:', videoResult.public_id);
    }

    // Upload thumbnail
    thumbnailResult = await cloudinary.uploader.upload(req.files.thumbnail[0].path, {
      folder: 'streamflix/thumbnails',
      use_filename: true,
      unique_filename: false
    });
    console.log('Thumbnail uploaded to Cloudinary:', thumbnailResult.public_id);

    // Upload trailer if provided
    let trailerData = {};
    if (req.files.trailer && req.files.trailer[0]) {
      trailerResult = await cloudinary.uploader.upload(req.files.trailer[0].path, {
        resource_type: 'video',
        folder: 'streamflix/trailers',
        use_filename: true,
        unique_filename: false
      });
      trailerData = {
        url: trailerResult.secure_url,
        cloudinaryId: trailerResult.public_id
      };
      console.log('Trailer uploaded to Cloudinary:', trailerResult.public_id);
    }

    // Handle series episodes
    let seasonsData = [];
    if (type === 'series' && req.files.episodes) {
      const episodes = req.files.episodes;
      const parsedEpisodeData = JSON.parse(episodeData);
      
      for (let i = 0; i < episodes.length; i++) {
        const episodeFile = episodes[i];
        const episodeInfo = parsedEpisodeData[i];
        
        const episodeResult = await cloudinary.uploader.upload(episodeFile.path, {
          resource_type: 'video',
          folder: `streamflix/series/${title}/season${seasonNumber || 1}`,
          use_filename: true,
          unique_filename: false
        });
        
        episodeResults.push(episodeResult);
        console.log(`Episode ${i + 1} uploaded to Cloudinary:`, episodeResult.public_id);
      }
      
      // Organize episodes into seasons
      seasonsData = [{
        seasonNumber: parseInt(seasonNumber) || 1,
        title: `Season ${seasonNumber || 1}`,
        description: `Season ${seasonNumber || 1} of ${title}`,
        episodes: episodeResults.map((result, index) => ({
          episodeNumber: index + 1,
          title: parsedEpisodeData[index]?.title || `Episode ${index + 1}`,
          description: parsedEpisodeData[index]?.description || '',
          duration: parsedEpisodeData[index]?.duration || 45,
          videoUrl: result.secure_url,
          cloudinaryId: result.public_id,
          thumbnail: thumbnailResult.secure_url, // Use main thumbnail for episodes
          airDate: new Date(),
          views: 0
        }))
      }];
    }

    // Parse other JSON fields safely
    let parsedGenre = [];
    if (genre) {
      try {
        parsedGenre = typeof genre === 'string' ? JSON.parse(genre) : Array.isArray(genre) ? genre : [genre];
      } catch (error) {
        parsedGenre = typeof genre === 'string' ? genre.split(',').map(g => g.trim()) : [genre];
      }
    }

    let parsedCast = [];
    if (cast) {
      try {
        parsedCast = typeof cast === 'string' ? JSON.parse(cast) : Array.isArray(cast) ? cast : [];
      } catch (error) {
        console.log('Cast parsing error, skipping:', error);
        parsedCast = [];
      }
    }

    let parsedSubtitles = [];
    if (subtitles) {
      try {
        parsedSubtitles = typeof subtitles === 'string' ? JSON.parse(subtitles) : Array.isArray(subtitles) ? subtitles : [];
      } catch (error) {
        console.log('Subtitles parsing error, skipping:', error);
        parsedSubtitles = [];
      }
    }

    let parsedTags = [];
    if (tags) {
      try {
        parsedTags = typeof tags === 'string' ? JSON.parse(tags) : Array.isArray(tags) ? tags : [];
      } catch (error) {
        console.log('Tags parsing error, treating as string:', error);
        parsedTags = typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : [];
      }
    }

    console.log('Creating video document...');

    const videoData = {
      title,
      description,
      genre: parsedGenre,
      type,
      releaseYear: releaseYear ? parseInt(releaseYear) : new Date().getFullYear(),
      rating: rating || 'PG',
      language: language || 'en',
      thumbnail: thumbnailResult.secure_url,
      uploadedBy: req.user.id,
      isActive: true
    };

    // Add type-specific data
    if (type === 'movie') {
      videoData.videoUrl = videoResult.secure_url;
      videoData.cloudinaryId = videoResult.public_id;
      videoData.duration = duration ? parseInt(duration) : undefined;
    } else if (type === 'series') {
      videoData.seasons = seasonsData;
      videoData.videoUrl = seasonsData[0]?.episodes[0]?.videoUrl || '';
      videoData.cloudinaryId = seasonsData[0]?.episodes[0]?.cloudinaryId || '';
      videoData.totalEpisodes = episodeResults.length;
    }

    // Add optional fields
    if (imdbRating) videoData.imdbRating = parseFloat(imdbRating);
    if (director) videoData.director = director;
    if (producer) videoData.producer = producer;
    if (Object.keys(trailerData).length > 0) videoData.trailer = trailerData;

    const video = new Video(videoData);
    await video.save();

    console.log('Video saved to database:', video._id);

    res.status(201).json({
      success: true,
      message: `${type === 'series' ? 'Series' : 'Movie'} uploaded successfully`,
      video: {
        id: video._id,
        title: video.title,
        type: video.type,
        thumbnail: video.thumbnail,
        totalEpisodes: video.totalEpisodes
      }
    });
  } catch (error) {
    console.error('Video upload error:', error);
    
    // Clean up uploaded files if database save fails
    try {
      if (videoResult?.public_id) {
        await cloudinary.uploader.destroy(videoResult.public_id, { resource_type: 'video' });
      }
      if (thumbnailResult?.public_id) {
        await cloudinary.uploader.destroy(thumbnailResult.public_id);
      }
      if (trailerResult?.public_id) {
        await cloudinary.uploader.destroy(trailerResult.public_id, { resource_type: 'video' });
      }
      // Clean up episode files
      for (const episodeResult of episodeResults) {
        if (episodeResult?.public_id) {
          await cloudinary.uploader.destroy(episodeResult.public_id, { resource_type: 'video' });
        }
      }
    } catch (cleanupError) {
      console.error('Error cleaning up files:', cleanupError);
    }
    
    res.status(500).json({ 
      success: false,
      message: 'Failed to upload video', 
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// @route   GET /api/videos/:id/episodes
// @desc    Get episodes for a series
// @access  Private
router.get('/:id/episodes', protect, async (req, res) => {
  try {
    const { seasonNumber } = req.query;
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    if (video.type !== 'series') {
      return res.status(400).json({ message: 'This is not a series' });
    }

    let episodes = [];
    if (seasonNumber) {
      const season = video.seasons.find(s => s.seasonNumber === parseInt(seasonNumber));
      episodes = season ? season.episodes : [];
    } else {
      // Return all episodes from all seasons
      episodes = video.seasons.reduce((all, season) => {
        return all.concat(season.episodes.map(ep => ({
          ...ep.toObject(),
          seasonNumber: season.seasonNumber
        })));
      }, []);
    }

    res.json(episodes);
  } catch (error) {
    console.error('Get episodes error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/videos/:id/episodes/:episodeId/watch
// @desc    Update watch history for specific episode
// @access  Private
router.post('/:id/episodes/:episodeId/watch', protect, async (req, res) => {
  try {
    const { profileId, progress } = req.body;
    const user = await User.findById(req.user.id);
    const profile = user.profiles.id(profileId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Update episode view count
    const video = await Video.findById(req.params.id);
    if (video && video.type === 'series') {
      let episodeFound = false;
      video.seasons.forEach(season => {
        const episode = season.episodes.id(req.params.episodeId);
        if (episode) {
          episode.views += 1;
          episodeFound = true;
        }
      });
      
      if (episodeFound) {
        await video.save();
      }
    }

    // Update user watch history
    const watchKey = `${req.params.id}_${req.params.episodeId}`;
    const existingWatch = profile.watchHistory.find(
      item => item.videoId.toString() === watchKey
    );

    if (existingWatch) {
      existingWatch.progress = progress;
      existingWatch.watchedAt = new Date();
    } else {
      profile.watchHistory.push({
        videoId: watchKey,
        progress,
        watchedAt: new Date()
      });
    }

    await user.save();
    res.json({ message: 'Episode watch history updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/videos/:id/watch
// @desc    Update watch history
// @access  Private
router.post('/:id/watch', protect, async (req, res) => {
  try {
    const { profileId, progress } = req.body;
    const user = await User.findById(req.user.id);
    const profile = user.profiles.id(profileId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    // Update or add to watch history
    const existingWatch = profile.watchHistory.find(
      item => item.videoId.toString() === req.params.id
    );

    if (existingWatch) {
      existingWatch.progress = progress;
      existingWatch.watchedAt = new Date();
    } else {
      profile.watchHistory.push({
        videoId: req.params.id,
        progress,
        watchedAt: new Date()
      });
    }

    await user.save();
    res.json({ message: 'Watch history updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/videos/:id/watchlist
// @desc    Add/remove from watchlist
// @access  Private
router.post('/:id/watchlist', protect, async (req, res) => {
  try {
    const { profileId } = req.body;
    const user = await User.findById(req.user.id);
    const profile = user.profiles.id(profileId);

    if (!profile) {
      return res.status(404).json({ message: 'Profile not found' });
    }

    const videoId = req.params.id;
    const isInWatchlist = profile.watchlist.includes(videoId);

    if (isInWatchlist) {
      profile.watchlist = profile.watchlist.filter(id => id.toString() !== videoId);
    } else {
      profile.watchlist.push(videoId);
    }

    await user.save();
    
    res.json({ 
      message: isInWatchlist ? 'Removed from watchlist' : 'Added to watchlist',
      inWatchlist: !isInWatchlist
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
