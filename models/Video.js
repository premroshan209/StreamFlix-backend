const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  genre: [{
    type: String,
    required: true
  }],
  type: {
    type: String,
    enum: ['movie', 'series', 'documentary'],
    required: true
  },
  releaseYear: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: function() {
      return this.type === 'movie';
    }
  },
  rating: {
    type: String,
    enum: ['G', 'PG', 'PG-13', 'R', 'NC-17'],
    default: 'PG'
  },
  imdbRating: {
    type: Number,
    min: 0,
    max: 10
  },
  cast: [{
    name: String,
    role: String,
    image: String
  }],
  director: String,
  producer: String,
  language: {
    type: String,
    default: 'en'
  },
  subtitles: [String],
  thumbnail: {
    type: String,
    required: true
  },
  trailer: {
    url: String,
    cloudinaryId: String
  },
  videoUrl: {
    type: String,
    required: true
  },
  cloudinaryId: {
    type: String,
    required: true
  },
  // For series - updated structure
  seasons: [{
    seasonNumber: {
      type: Number,
      required: function() {
        return this.parent().type === 'series';
      }
    },
    title: String,
    description: String,
    episodes: [{
      episodeNumber: {
        type: Number,
        required: true
      },
      title: {
        type: String,
        required: true
      },
      description: String,
      duration: Number, // in minutes
      videoUrl: {
        type: String,
        required: true
      },
      cloudinaryId: {
        type: String,
        required: true
      },
      thumbnail: String,
      airDate: Date,
      views: {
        type: Number,
        default: 0
      }
    }]
  }],
  // Total episodes count for series
  totalEpisodes: {
    type: Number,
    default: function() {
      if (this.type === 'series' && this.seasons) {
        return this.seasons.reduce((total, season) => total + season.episodes.length, 0);
      }
      return 1;
    }
  },
  tags: [String],
  isActive: {
    type: Boolean,
    default: true
  },
  views: {
    type: Number,
    default: 0
  },
  likes: {
    type: Number,
    default: 0
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Remove all text indexes - using regex search instead
// Create only basic indexes for performance
videoSchema.index({ title: 1 });
videoSchema.index({ genre: 1 });
videoSchema.index({ type: 1 });
videoSchema.index({ isActive: 1 });
videoSchema.index({ views: -1 });
videoSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Video', videoSchema);
