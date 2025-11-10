const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { startSubscriptionCrons } = require('./utils/subscriptionCron');

dotenv.config();

const app = express();

// CORS configuration for production
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,
  process.env.VERCEL_URL
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('vercel.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'StreamFlix API is running',
    version: '1.0.0',
    status: 'healthy'
  });
});

app.get('/api', (req, res) => {
  res.json({ 
    message: 'StreamFlix API v1.0',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      videos: '/api/videos',
      subscriptions: '/api/subscriptions',
      admin: '/api/admin'
    }
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/admin', require('./routes/admin'));

// Database connection with retry logic
const connectDB = async (retries = 5) => {
  try {
    const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI;
    
    if (!mongoURI) {
      throw new Error('❌ MongoDB URI is not defined in environment variables');
    }

    if (mongoURI.includes('<password>')) {
      throw new Error('❌ Please replace <password> in MONGODB_URI with your actual password');
    }

    if (mongoURI.includes('your_username') || mongoURI.includes('your_password')) {
      throw new Error('❌ Please update MONGODB_URI in .env file with your actual credentials');
    }

    console.log('🔌 Connecting to MongoDB...');
    console.log('📍 Using database:', mongoURI.split('@')[1]?.split('/')[1]?.split('?')[0] || 'Unknown');
    
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    
    console.log('✅ MongoDB Connected Successfully');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log(`🌐 Host: ${mongoose.connection.host}`);
    
    // Start cron jobs only in production
    if (process.env.NODE_ENV === 'production') {
      startSubscriptionCrons();
    } else {
      console.log('⏭️  Subscription cron jobs disabled in development mode');
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    if (error.message.includes('querySrv ENOTFOUND')) {
      console.log('\n🔧 DNS Resolution Error - Possible causes:');
      console.log('   1. ❌ Connection string format is incorrect');
      console.log('   2. ❌ Cluster address is wrong');
      console.log('   3. ❌ MongoDB Atlas cluster is not created yet');
      console.log('\n✅ Solution:');
      console.log('   1. Go to https://cloud.mongodb.com/');
      console.log('   2. Create a FREE cluster');
      console.log('   3. Get the connection string from "Connect" button');
      console.log('   4. Update MONGODB_URI in .env file\n');
    } else if (error.message.includes('Authentication failed')) {
      console.log('\n🔧 Authentication Error:');
      console.log('   ❌ Username or password is incorrect');
      console.log('   ✅ Check your credentials in MongoDB Atlas');
      console.log('   ✅ Encode special characters in password\n');
    } else if (error.message.includes('not authorized')) {
      console.log('\n🔧 Authorization Error:');
      console.log('   ❌ Database user doesn\'t have access');
      console.log('   ✅ Check user permissions in MongoDB Atlas\n');
    }
    
    if (retries > 0) {
      console.log(`🔄 Retrying connection... (${retries} attempts left)`);
      setTimeout(() => connectDB(retries - 1), 5000);
    } else {
      console.error('\n❌ Failed to connect to MongoDB after multiple attempts\n');
      
      if (process.env.NODE_ENV !== 'production') {
        console.log('⚠️  Server will continue running without database connection');
        console.log('⚠️  API endpoints will not work until database is connected\n');
      } else {
        console.log('❌ Exiting... Database is required in production\n');
        process.exit(1);
      }
    }
  }
};

connectDB();

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 8000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export for Vercel
module.exports = app;
