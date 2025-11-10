const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

// Helper to upload from base64
const uploadBase64 = async (base64String, options = {}) => {
  try {
    const result = await cloudinary.uploader.upload(base64String, {
      ...options,
      timeout: 120000, // 2 minutes
    });
    return result;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw error;
  }
};

module.exports = { cloudinary, uploadBase64 };
