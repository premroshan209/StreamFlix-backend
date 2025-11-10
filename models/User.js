const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const profileSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    maxlength: 50
  },
  avatar: {
    type: String,
    default: ''
  },
  age: {
    type: Number,
    min: 13,
    max: 100
  },
  gender: {
    type: String,
    enum: ['male', 'female', 'other', 'prefer-not-to-say']
  },
  preferences: {
    genres: [String],
    language: {
      type: String,
      default: 'en'
    }
  },
  watchHistory: [{
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video'
    },
    watchedAt: {
      type: Date,
      default: Date.now
    },
    progress: {
      type: Number,
      default: 0
    }
  }],
  watchlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Video'
  }]
});

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  profiles: [profileSchema],
  subscription: {
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubscriptionPlan'
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'cancelled', 'expired'],
      default: 'inactive'
    },
    startDate: Date,
    endDate: Date,
    autoRenew: {
      type: Boolean,
      default: true
    },
    razorpaySubscriptionId: String
  },
  paymentHistory: [{
    amount: Number,
    currency: String,
    status: String,
    razorpayPaymentId: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  resetPasswordToken: String,
  resetPasswordExpire: Date
}, {
  timestamps: true
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('password') && !this.isNew) {
    return next();
  }
  
  // Hash password if modified
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  
  // Create default profile for new users
  if (this.isNew && this.profiles.length === 0) {
    this.profiles.push({
      name: this.name,
      avatar: '',
      preferences: {
        genres: [],
        language: 'en'
      },
      watchHistory: [],
      watchlist: []
    });
  }
  
  next();
});

userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
