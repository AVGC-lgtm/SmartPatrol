// middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { s3, bucketName, isConfigured } = require('../config/awsConfig');

// Helper function to determine file type
const getFileType = (mimetype) => {
  if (mimetype.startsWith('image/')) return 'images';
  if (mimetype.startsWith('video/')) return 'videos';
  if (mimetype.startsWith('audio/')) return 'audios';
  return 'others';
};

// Configure multer for memory storage (direct to S3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 10 // Maximum 10 files per request
  },
  fileFilter: function (req, file, cb) {
    // Allowed file types
    const allowedMimes = [
      // Images
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      // Videos
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/mp4',
      'audio/ogg',
      'audio/webm'
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: images (jpg, png, gif, webp), videos (mp4, mpeg, mov, avi, webm), audio (mp3, wav, m4a, ogg, webm)`), false);
    }
  }
});

// Function to upload file to S3 (direct from memory)
const uploadFileToS3 = (file, userId, checkpointId) => {
  return new Promise((resolve, reject) => {
    // Check if S3 is configured
    if (!s3 || !bucketName || !process.env.AWS_ACCESS_KEY_ID) {
      return reject(new Error('AWS S3 is not configured. Please configure AWS credentials.'));
    }

    const fileType = getFileType(file.mimetype);
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    const timestamp = Date.now();
    const date = new Date().toISOString().split('T')[0];
    
    const key = `checkpoint-scans/${fileType}/${date}/${userId}-${checkpointId}-${timestamp}-${uniqueId}${ext}`;
    
    const params = {
      Bucket: bucketName,
      Key: key,
      Body: file.buffer, // Use buffer from memory storage
      ContentType: file.mimetype,
      ACL: 'public-read',
      Metadata: {
        userId: userId.toString(),
        checkpointId: checkpointId.toString(),
        originalName: file.originalname,
        uploadedAt: new Date().toISOString()
      }
    };

    s3.upload(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data.Location);
      }
    });
  });
};

// Middleware for checkpoint scan uploads
const checkpointScanUpload = upload.fields([
  { name: 'images', maxCount: 5 },
  { name: 'videos', maxCount: 3 },
  { name: 'audios', maxCount: 3 }
]);

// Error handling middleware
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 100MB per file.'
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: 'Too many files. Maximum 10 files per request.'
      });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected field name. Use "images", "videos", or "audios".'
      });
    }
  }
  
  if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'File upload failed'
    });
  }
  
  next();
};

// Function to delete files from S3
const deleteFromS3 = async (fileUrls) => {
  if (!fileUrls || fileUrls.length === 0) return;
  
  if (!s3 || !bucketName) {
    throw new Error('AWS S3 is not configured');
  }

  const deleteParams = {
    Bucket: bucketName,
    Delete: {
      Objects: fileUrls.map(url => {
        // Extract key from S3 URL
        const key = url.split('.com/')[1] || url.split(`${bucketName}/`)[1];
        return { Key: key };
      }),
      Quiet: false
    }
  };

  try {
    const result = await s3.deleteObjects(deleteParams).promise();
    console.log('Files deleted from S3:', result.Deleted?.length || 0);
    return result;
  } catch (error) {
    console.error('Error deleting files from S3:', error);
    throw error;
  }
};

module.exports = {
  checkpointScanUpload,
  handleUploadError,
  deleteFromS3,
  uploadFileToS3
};