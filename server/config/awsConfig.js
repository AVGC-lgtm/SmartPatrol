// config/awsConfig.js
const AWS = require('aws-sdk');
require('dotenv').config();

let s3 = null;
let isConfigured = false;

// Configure AWS SDK only if credentials are provided
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  try {
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1'
    });

    // Create S3 instance
    s3 = new AWS.S3();
    isConfigured = true;
    console.log('AWS S3 configured successfully');
  } catch (error) {
    console.warn('AWS S3 configuration failed:', error.message);
    console.log('Files will be stored locally instead');
  }
} else {
  console.log('AWS credentials not found. Files will be stored locally.');
}

// S3 Bucket name
const bucketName = process.env.AWS_S3_BUCKET_NAME || 'smart-patrol-media';

module.exports = {
  AWS,
  s3,
  bucketName,
  isConfigured
};