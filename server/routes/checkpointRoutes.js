// routes/checkpointRoutes.js

const express = require('express');
const router = express.Router();
const checkpointController = require('../controllers/checkpointController');
const { checkpointScanUpload, handleUploadError } = require('../middlewares/uploadMiddleware');

// Validation middleware for policeStationId
const validatePoliceStationId = (req, res, next) => {
  if (req.body.policeStationId) {
    const policeStationId = Number(req.body.policeStationId);
    if (!Number.isInteger(policeStationId) || policeStationId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'policeStationId must be a valid positive integer'
      });
    }
    req.body.policeStationId = policeStationId;
  }
  next();
};

// Create Checkpoint (policeStationId required)
router.post('/', validatePoliceStationId, checkpointController.createCheckpoint);

// Get All Checkpoints (with pagination, search, and police station filter)
router.get('/', checkpointController.getAllCheckpoints);

// Get Checkpoints by Police Station ID
router.get('/police-station/:policeStationId', checkpointController.getCheckpointsByPoliceStation);

// Get Checkpoint Scan History (with police station filter)
router.get('/scans', checkpointController.getCheckpointScans);

// Get Single Scan Details
router.get('/scans/:id', checkpointController.getScanById);

// Get Checkpoint by ID
router.get('/:id', checkpointController.getCheckpointById);

// Update Checkpoint (policeStationId optional for updates)
router.put('/:id', validatePoliceStationId, checkpointController.updateCheckpoint);

// Delete Checkpoint (soft delete)
router.delete('/:id', checkpointController.deleteCheckpoint);

// Get QR Code data (includes policeStationId and createTime)
router.get('/:id/qrcode', checkpointController.getCheckpointQRCode);

// Download QR Code as file (includes policeStationId in QR data)
router.get('/:id/qrcode/download', checkpointController.downloadCheckpointQRCode);

// Scan QR Code - WITH FILE UPLOAD SUPPORT
router.post('/scan-qr', 
  checkpointScanUpload,
  handleUploadError,
  checkpointController.scanQRCode
);


module.exports = router;