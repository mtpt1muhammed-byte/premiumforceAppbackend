// config/s3Config.js
const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const crypto = require('crypto');

// Debug: Check if environment variables are loaded
console.log('Loading S3 Config...');
console.log('AWS_REGION:', process.env.AWS_REGION);
console.log('AWS_S3_BUCKET_NAME:', process.env.AWS_S3_BUCKET_NAME);
console.log('AWS_ACCESS_KEY_ID exists:', !!process.env.AWS_ACCESS_KEY_ID);

// Validate required environment variables
if (!process.env.AWS_S3_BUCKET_NAME) {
  console.error('ERROR: AWS_S3_BUCKET_NAME is not defined in environment variables');
  process.exit(1); // Exit if bucket name is missing
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error('ERROR: AWS credentials are not defined in environment variables');
  process.exit(1);
}

// Configure S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-southeast-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
};

// Generate unique filename
const generateFileName = (originalname) => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(16).toString('hex');
  const extension = path.extname(originalname);
  return `profile-images/${timestamp}-${randomString}${extension}`;
};

// Configure multer for S3 upload
console.log('Creating multer S3 storage with bucket:', process.env.AWS_S3_BUCKET_NAME);

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.AWS_S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE, // THIS IS THE KEY FIX - automatically sets correct Content-Type
    metadata: (req, file, cb) => {
      cb(null, { 
        fieldName: file.fieldname,
        originalName: file.originalname,
        contentType: file.mimetype // Store the content type in metadata
      });
    },
    key: (req, file, cb) => {
      const fileName = generateFileName(file.originalname);
      console.log('Generated S3 key:', fileName);
      cb(null, fileName);
    }
  }),
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Function to delete file from S3
const deleteFromS3 = async (key) => {
  const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
  
  try {
    console.log('Deleting from S3:', key);
    const deleteParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: key
    };
    
    const command = new DeleteObjectCommand(deleteParams);
    await s3Client.send(command);
    console.log('Successfully deleted from S3:', key);
    return true;
  } catch (error) {
    console.error('Error deleting from S3:', error);
    throw error;
  }
};

// Generate public URL for S3 object
const getS3Url = (key) => {
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

console.log('S3 Config loaded successfully');

module.exports = {
  s3Client,
  upload,
  deleteFromS3,
  getS3Url
};