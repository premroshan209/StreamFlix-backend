const mongoose = require('mongoose');

const subscriptionPlanSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    enum: ['Basic Monthly', 'Basic Yearly', 'Advance Monthly', 'Advance Yearly']
  },
  type: {
    type: String,
    required: true,
    enum: ['basic', 'advance']
  },
  billing: {
    type: String,
    required: true,
    enum: ['monthly', 'yearly']
  },
  price: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  features: [{
    type: String,
    required: true
  }],
  videoQuality: {
    type: String,
    enum: ['720p', '1080p', '4K'],
    required: true
  },
  simultaneousStreams: {
    type: Number,
    required: true,
    min: 1
  },
  downloadLimit: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
