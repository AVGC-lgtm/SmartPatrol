// controllers/checkpointController.js
const Checkpoint = require('../models/Checkpoint');
const RouteAssignment = require('../models/RouteAssignment');
const Route = require('../models/Route');
const CheckpointScan = require('../models/CheckpointScan');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { Op, fn, col } = require('sequelize'); // Add fn and col imports
const { uploadFileToS3 } = require('../middlewares/uploadMiddleware');

// If you have a sequelize instance file, import it like this:
// const { sequelize } = require('../config/database'); // Adjust path as needed
// OR if you need the sequelize instance from one of your models:
// const sequelize = Checkpoint.sequelize; // Use this if you don't have a separate config file

// Helper function to validate lat_long format
const validateLatLong = (latLong) => {
  if (!latLong || typeof latLong !== 'string') {
    return { valid: false, message: 'lat_long must be a string' };
  }

  const parts = latLong.split(',');
  if (parts.length !== 2) {
    return { valid: false, message: 'lat_long must be in format "latitude,longitude"' };
  }

  const lat = parseFloat(parts[0].trim());
  const lng = parseFloat(parts[1].trim());

  if (isNaN(lat) || isNaN(lng)) {
    return { valid: false, message: 'Invalid latitude or longitude values' };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, message: 'Latitude must be between -90 and 90, longitude between -180 and 180' };
  }

  return { valid: true, latitude: lat, longitude: lng };
};

// Create Checkpoint
exports.createCheckpoint = async (req, res) => {
  try {
    const { name, description, lat_long, address, policeStationId } = req.body;

    // Input validation
    if (!name || !lat_long || !policeStationId) {
      return res.status(400).json({
        success: false,
        message: 'Name, lat_long, and policeStationId are required',
      });
    }

    // Validate policeStationId
    if (!Number.isInteger(Number(policeStationId)) || Number(policeStationId) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'policeStationId must be a valid positive integer',
      });
    }

    // Validate lat_long format
    const latLongValidation = validateLatLong(lat_long);
    if (!latLongValidation.valid) {
      return res.status(400).json({
        success: false,
        message: latLongValidation.message,
      });
    }

    const { latitude, longitude } = latLongValidation;

    // Generate unique QR code identifier
    const qrCodeId = `CP_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Create QR code data with lat_long included
    const qrData = JSON.stringify({
      id: qrCodeId,
      name: name,
      lat_long: lat_long,
      latitude: latitude,
      longitude: longitude,
      policeStationId: Number(policeStationId),
      type: 'checkpoint'
    });

    // Generate QR code as data URL
    const qrCodeUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
    });

    const checkpoint = await Checkpoint.create({
      name,
      description,
      lat_long: lat_long,
      address,
      policeStationId: Number(policeStationId),
      scanRadius: 50, // Default 50 meters
      qrCode: qrCodeId,
      qrCodeUrl,
    });

    res.status(201).json({
      success: true,
      message: 'Checkpoint created successfully',
      data: {
        ...checkpoint.toJSON(),
        extracted_coordinates: {
          latitude: latitude,
          longitude: longitude
        }
      },
    });
  } catch (error) {
    console.error('Create checkpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create checkpoint',
      error: error.message,
    });
  }
};

// Get All Checkpoints
exports.getAllCheckpoints = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, policeStationId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = { isActive: true };
    
    // Filter by police station if provided
    if (policeStationId) {
      whereClause.policeStationId = parseInt(policeStationId);
    }
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
        { lat_long: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows: checkpoints } = await Checkpoint.findAndCountAll({
      where: whereClause,
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    // Add extracted coordinates to response
    const checkpointsWithCoords = checkpoints.map(checkpoint => ({
      ...checkpoint.toJSON(),
      extracted_coordinates: {
        latitude: checkpoint.getLatitude(),
        longitude: checkpoint.getLongitude()
      }
    }));

    res.status(200).json({
      success: true,
      data: {
        checkpoints: checkpointsWithCoords,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get checkpoints error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoints',
      error: error.message,
    });
  }
};

// Get Checkpoint by ID
exports.getCheckpointById = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    const checkpoint = await Checkpoint.findByPk(id);

    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...checkpoint.toJSON(),
        extracted_coordinates: {
          latitude: checkpoint.getLatitude(),
          longitude: checkpoint.getLongitude()
        }
      },
    });
  } catch (error) {
    console.error('Get checkpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoint',
      error: error.message,
    });
  }
};

// Update Checkpoint with QR Code Regeneration
exports.updateCheckpoint = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    const checkpoint = await Checkpoint.findByPk(id);
    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    // Validate lat_long if provided
    if (updateData.lat_long) {
      const latLongValidation = validateLatLong(updateData.lat_long);
      if (!latLongValidation.valid) {
        return res.status(400).json({
          success: false,
          message: latLongValidation.message,
        });
      }
    }

    // Validate policeStationId if provided
    if (updateData.policeStationId) {
      if (!Number.isInteger(Number(updateData.policeStationId)) || Number(updateData.policeStationId) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'policeStationId must be a valid positive integer',
        });
      }
      updateData.policeStationId = Number(updateData.policeStationId);
    }

    // Filter out sensitive fields
    const allowedFields = ['name', 'description', 'lat_long', 'address', 'scanRadius', 'policeStationId'];
    const filteredData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {});

    // Check if QR code needs to be regenerated (if name, lat_long, or policeStationId are being updated)
    const qrRelevantFields = ['name', 'lat_long', 'policeStationId'];
    const shouldRegenerateQR = qrRelevantFields.some(field => filteredData.hasOwnProperty(field));

    if (shouldRegenerateQR) {
      // Get the updated values (use new values if provided, otherwise keep existing)
      const updatedName = filteredData.name || checkpoint.name;
      const updatedLatLong = filteredData.lat_long || checkpoint.lat_long;
      const updatedPoliceStationId = filteredData.policeStationId || checkpoint.policeStationId;

      // Validate the lat_long for QR code generation
      const latLongValidation = validateLatLong(updatedLatLong);
      if (!latLongValidation.valid) {
        return res.status(400).json({
          success: false,
          message: `Invalid lat_long for QR code generation: ${latLongValidation.message}`,
        });
      }

      const { latitude, longitude } = latLongValidation;

      // Create new QR code data with updated information
      const qrData = JSON.stringify({
        id: checkpoint.qrCode, // Keep the same QR code ID
        name: updatedName,
        lat_long: updatedLatLong,
        latitude: latitude,
        longitude: longitude,
        policeStationId: updatedPoliceStationId,
        type: 'checkpoint'
      });

      // Generate new QR code URL
      const qrCodeUrl = await QRCode.toDataURL(qrData, {
        width: 300,
        margin: 2,
      });

      // Add the new QR code URL to the update data
      filteredData.qrCodeUrl = qrCodeUrl;
    }

    // Update the checkpoint
    await checkpoint.update(filteredData);

    // Reload the checkpoint to get updated data
    await checkpoint.reload();

    res.status(200).json({
      success: true,
      message: shouldRegenerateQR ? 
        'Checkpoint updated successfully with new QR code' : 
        'Checkpoint updated successfully',
      data: {
        ...checkpoint.toJSON(),
        extracted_coordinates: {
          latitude: checkpoint.getLatitude(),
          longitude: checkpoint.getLongitude()
        }
      },
    });
  } catch (error) {
    console.error('Update checkpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update checkpoint',
      error: error.message,
    });
  }
};

// Delete Checkpoint (Soft delete)
exports.deleteCheckpoint = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    const checkpoint = await Checkpoint.findByPk(id);
    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    await checkpoint.update({ isActive: false });

    res.status(200).json({
      success: true,
      message: 'Checkpoint deleted successfully',
    });
  } catch (error) {
    console.error('Delete checkpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete checkpoint',
      error: error.message,
    });
  }
};

// Get QR Code
exports.getCheckpointQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    const checkpoint = await Checkpoint.findByPk(id);

    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        checkpointId: checkpoint.id,
        name: checkpoint.name,
        lat_long: checkpoint.lat_long,
        policeStationId: checkpoint.policeStationId,
        qrCode: checkpoint.qrCode,
        qrCodeUrl: checkpoint.qrCodeUrl,
        createdAt: checkpoint.createdAt
      },
    });
  } catch (error) {
    console.error('Get QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get QR code',
      error: error.message,
    });
  }
};

// Download QR Code as PNG/SVG
exports.downloadCheckpointQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'png', size = 300 } = req.query;

    // Validate ID
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    // Validate format
    if (!['png', 'svg'].includes(format)) {
      return res.status(400).json({
        success: false,
        message: 'Format must be png or svg',
      });
    }

    // Validate size
    const qrSize = parseInt(size);
    if (qrSize < 100 || qrSize > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Size must be between 100 and 1000 pixels',
      });
    }

    const checkpoint = await Checkpoint.findByPk(id);

    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    // Create QR code data with lat_long and policeStationId
    const qrData = JSON.stringify({
      id: checkpoint.qrCode,
      name: checkpoint.name,
      lat_long: checkpoint.lat_long,
      latitude: checkpoint.getLatitude(),
      longitude: checkpoint.getLongitude(),
      policeStationId: checkpoint.policeStationId,
      type: 'checkpoint'
    });

    // Generate filename
    const sanitizedName = checkpoint.name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `checkpoint_${sanitizedName}_QR.${format}`;

    if (format === 'png') {
      // Generate QR code as PNG buffer
      const qrBuffer = await QRCode.toBuffer(qrData, {
        type: 'png',
        width: qrSize,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Set headers for file download
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', qrBuffer.length);

      // Send the buffer
      res.send(qrBuffer);

    } else if (format === 'svg') {
      // Generate QR code as SVG
      const qrSvg = await QRCode.toString(qrData, {
        type: 'svg',
        width: qrSize,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Set headers for file download
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Send the SVG
      res.send(qrSvg);
    }

  } catch (error) {
    console.error('Download QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download QR code',
      error: error.message,
    });
  }
};

// Get Checkpoint Scan History
exports.getCheckpointScans = async (req, res) => {
  try {
    const { checkpointId, userId, assignmentId, policeStationId } = req.query;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = {};
    const checkpointWhere = {};
    
    if (checkpointId) {
      whereClause.checkpointId = checkpointId;
    }
    if (userId) {
      whereClause.userId = userId;
    }
    if (assignmentId) {
      whereClause.routeAssignmentId = assignmentId;
    }
    if (policeStationId) {
      checkpointWhere.policeStationId = parseInt(policeStationId);
    }

    const { count, rows: scans } = await CheckpointScan.findAndCountAll({
      where: whereClause,
      order: [['scanTime', 'DESC']],
      limit: parseInt(limit),
      offset: offset,
      include: [
        {
          model: Checkpoint,
          attributes: ['id', 'name', 'lat_long', 'address', 'policeStationId'],
          where: Object.keys(checkpointWhere).length > 0 ? checkpointWhere : undefined
        }
      ]
    });

    res.status(200).json({
      success: true,
      data: {
        scans: scans,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get checkpoint scans error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoint scans',
      error: error.message,
    });
  }
};

// Get Single Scan Details
exports.getScanById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid scan ID',
      });
    }

    const scan = await CheckpointScan.findByPk(id, {
      include: [
        {
          model: Checkpoint,
          attributes: ['id', 'name', 'lat_long', 'address', 'description', 'policeStationId']
        },
        {
          model: RouteAssignment,
          attributes: ['id', 'status', 'startDate', 'endDate'],
          include: [
            {
              model: Route,
              attributes: ['id', 'name', 'description']
            }
          ]
        }
      ]
    });

    if (!scan) {
      return res.status(404).json({
        success: false,
        message: 'Scan not found',
      });
    }

    res.status(200).json({
      success: true,
      data: scan
    });
  } catch (error) {
    console.error('Get scan by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch scan details',
      error: error.message,
    });
  }
};

// Scan QR Code - WITH NOTES AND MEDIA SUPPORT
exports.scanQRCode = async (req, res) => {
  try {
    const { qrData, userLatLong, assignmentId, notes, userId } = req.body;
    
    // Input validation
    if (!userId || !qrData || !userLatLong || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'userId, qrData, userLatLong, and assignmentId are required',
      });
    }

    // Validate user coordinates
    const userLatLongValidation = validateLatLong(userLatLong);
    if (!userLatLongValidation.valid) {
      return res.status(400).json({
        success: false,
        message: `Invalid userLatLong: ${userLatLongValidation.message}`,
      });
    }

    const { latitude: userLat, longitude: userLng } = userLatLongValidation;

    // Parse QR code data
    let qrInfo;
    try {
      qrInfo = JSON.parse(qrData);
    } catch (e) {
      return res.status(400).json({
        success: false,
        message: 'Invalid QR code format',
      });
    }

    // Validate QR code structure
    if (!qrInfo.id || !qrInfo.type || qrInfo.type !== 'checkpoint') {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint QR code',
      });
    }

    // Find checkpoint by QR code
    const checkpoint = await Checkpoint.findOne({
      where: { qrCode: qrInfo.id, isActive: true }
    });

    if (!checkpoint) {
      return res.status(404).json({
        success: false,
        message: 'Invalid or inactive checkpoint QR code',
      });
    }

    const checkpointLat = checkpoint.getLatitude();
    const checkpointLng = checkpoint.getLongitude();

    // Calculate distance using Haversine formula
    const R = 6371e3; // Earth's radius in meters
    const φ1 = userLat * Math.PI / 180;
    const φ2 = checkpointLat * Math.PI / 180;
    const Δφ = (checkpointLat - userLat) * Math.PI / 180;
    const Δλ = (checkpointLng - userLng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    const scanRadius = checkpoint.scanRadius || 50;
    const isWithinRadius = distance <= scanRadius;

    if (!isWithinRadius) {
      return res.status(400).json({
        success: false,
        message: `You are ${Math.round(distance)} meters away. Move within ${scanRadius} meters to scan.`,
        data: {
          distance: Math.round(distance),
          requiredRadius: scanRadius,
          checkpoint_lat_long: checkpoint.lat_long,
          user_lat_long: userLatLong,
          policeStationId: checkpoint.policeStationId
        }
      });
    }

    // Get route assignment and update progress
    const assignment = await RouteAssignment.findOne({
      where: { 
        id: assignmentId,
        userId: userId,
        isActive: true,
        status: 'in_progress'
      }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'No active route assignment found. Please start your route first.',
      });
    }

    // Get route details
    const route = await Route.findByPk(assignment.routeId);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    // Check if checkpoint is part of the route
    if (!route.checkpoints.includes(checkpoint.id)) {
      return res.status(400).json({
        success: false,
        message: 'This checkpoint is not part of your assigned route',
      });
    }

    // Check if already scanned
    const completedCheckpoints = assignment.completedCheckpoints || [];
    if (completedCheckpoints.includes(checkpoint.id)) {
      return res.status(400).json({
        success: false,
        message: 'This checkpoint has already been scanned',
      });
    }

    // Process uploaded files and upload to S3
    const uploadedFiles = {
      images: [],
      videos: [],
      audios: []
    };

    if (req.files) {
      try {
        // Upload images to S3
        if (req.files.images && req.files.images.length > 0) {
          const imagePromises = req.files.images.map(file => 
            uploadFileToS3(file, userId, checkpoint.id)
          );
          uploadedFiles.images = await Promise.all(imagePromises);
        }

        // Upload videos to S3
        if (req.files.videos && req.files.videos.length > 0) {
          const videoPromises = req.files.videos.map(file => 
            uploadFileToS3(file, userId, checkpoint.id)
          );
          uploadedFiles.videos = await Promise.all(videoPromises);
        }

        // Upload audios to S3
        if (req.files.audios && req.files.audios.length > 0) {
          const audioPromises = req.files.audios.map(file => 
            uploadFileToS3(file, userId, checkpoint.id)
          );
          uploadedFiles.audios = await Promise.all(audioPromises);
        }
      } catch (uploadError) {
        console.error('File upload error:', uploadError);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload media files',
          error: uploadError.message
        });
      }
    }

    // Save checkpoint scan details with notes and media
    const checkpointScan = await CheckpointScan.create({
      userId: userId,
      checkpointId: checkpoint.id,
      routeAssignmentId: assignmentId,
      userLatLong: userLatLong,
      distance: Math.round(distance),
      notes: notes || null,
      images: uploadedFiles.images,
      videos: uploadedFiles.videos,
      audios: uploadedFiles.audios,
      metadata: {
        userAgent: req.headers['user-agent'],
        scanTime: new Date().toISOString(),
        scanRadius: scanRadius,
        policeStationId: checkpoint.policeStationId
      },
      isValid: true
    });

    // Update completed checkpoints
    const newCompletedCheckpoints = [...completedCheckpoints, checkpoint.id];
    const totalCheckpoints = route.checkpoints.length;
    const isRouteCompleted = newCompletedCheckpoints.length === totalCheckpoints;

    // Update assignment
    const updateData = {
      completedCheckpoints: newCompletedCheckpoints,
      status: isRouteCompleted ? 'completed' : 'in_progress'
    };

    if (isRouteCompleted) {
      updateData.endDate = new Date();
      updateData.notes = `Route completed at ${new Date().toLocaleString()}`;
    }

    await assignment.update(updateData);

    // Calculate progress
    const progress = {
      totalCheckpoints: totalCheckpoints,
      completedCheckpoints: newCompletedCheckpoints.length,
      percentage: Math.round((newCompletedCheckpoints.length / totalCheckpoints) * 100),
      isCompleted: isRouteCompleted,
      remainingCheckpoints: route.checkpoints.filter(id => !newCompletedCheckpoints.includes(id))
    };

    res.status(200).json({
      success: true,
      message: isRouteCompleted ? 
        'Checkpoint scanned! Route completed successfully!' : 
        'Checkpoint scanned successfully',
      data: {
        scanId: checkpointScan.id,
        checkpoint: {
          id: checkpoint.id,
          name: checkpoint.name,
          address: checkpoint.address,
          lat_long: checkpoint.lat_long,
          policeStationId: checkpoint.policeStationId,
        },
        distance: Math.round(distance),
        scanRadius: scanRadius,
        assignment: {
          id: assignment.id,
          status: assignment.status
        },
        progress: progress,
        timestamp: new Date().toISOString(),
        coordinates: {
          checkpoint_lat_long: checkpoint.lat_long,
          user_lat_long: userLatLong
        },
        scanDetails: {
          notes: notes || null,
          mediaUploaded: {
            images: uploadedFiles.images.length,
            videos: uploadedFiles.videos.length,
            audios: uploadedFiles.audios.length
          },
          mediaUrls: {
            images: uploadedFiles.images,
            videos: uploadedFiles.videos,
            audios: uploadedFiles.audios
          }
        }
      }
    });
  } catch (error) {
    console.error('Scan QR code error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to scan QR code',
      error: error.message,
    });
  }
};

// Enhanced function to get checkpoints with RouteAssignment and CheckpointScan details
exports.getCheckpointsByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, search, status, userId } = req.query;
    
    // Validate policeStationId
    if (!policeStationId || isNaN(policeStationId) || parseInt(policeStationId) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid police station ID. Must be a positive integer.',
      });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Build where clauses for different tables
    const routeAssignmentWhere = { 
      policeStationId: parseInt(policeStationId),
      isActive: true
    };
    
    const checkpointWhere = { 
      isActive: true 
    };
    
    const checkpointScanWhere = {};
    
    // Add optional filters
    if (status) {
      routeAssignmentWhere.status = status;
    }
    
    if (userId) {
      routeAssignmentWhere.userId = parseInt(userId);
    }
    
    // Add search functionality for checkpoints
    if (search) {
      checkpointWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { address: { [Op.iLike]: `%${search}%` } },
        { lat_long: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Method 1: Start from RouteAssignment and include related data
    const { count, rows: routeAssignments } = await RouteAssignment.findAndCountAll({
      where: routeAssignmentWhere,
      include: [
        {
          model: CheckpointScan,
          as: 'checkpointScans',
          where: checkpointScanWhere,
          required: false, // LEFT JOIN - include RouteAssignments even without scans
          include: [
            {
              model: Checkpoint,
              as: 'checkpoint',
              where: checkpointWhere,
              required: true // INNER JOIN - only include scans with valid checkpoints
            }
          ]
        }
      ],
      order: [
        ['id', 'DESC'],
        [{ model: CheckpointScan, as: 'checkpointScans' }, 'scanTime', 'DESC']
      ],
      limit: parseInt(limit),
      offset: offset,
      distinct: true // Important for accurate count with associations
    });

    // Transform the data for better readability
    const transformedData = routeAssignments.map(assignment => {
      const assignmentData = assignment.toJSON();
      
      // Group checkpoint scans by checkpoint
      const checkpointMap = new Map();
      
      assignmentData.checkpointScans.forEach(scan => {
        const checkpointId = scan.checkpoint.id;
        
        if (!checkpointMap.has(checkpointId)) {
          checkpointMap.set(checkpointId, {
            checkpoint: {
              ...scan.checkpoint,
              extracted_coordinates: {
                latitude: scan.checkpoint.getLatitude ? scan.checkpoint.getLatitude() : null,
                longitude: scan.checkpoint.getLongitude ? scan.checkpoint.getLongitude() : null
              }
            },
            scans: []
          });
        }
        
        // Add scan details (without repeating checkpoint info)
        const { checkpoint, ...scanData } = scan;
        checkpointMap.get(checkpointId).scans.push(scanData);
      });
      
      return {
        routeAssignment: {
          id: assignmentData.id,
          userId: assignmentData.userId,
          routeId: assignmentData.routeId,
          policeStationId: assignmentData.policeStationId,
          startDate: assignmentData.startDate,
          endDate: assignmentData.endDate,
          status: assignmentData.status,
          completedCheckpoints: assignmentData.completedCheckpoints,
          notes: assignmentData.notes,
          isActive: assignmentData.isActive,
          createdAt: assignmentData.createdAt,
          updatedAt: assignmentData.updatedAt
        },
        checkpoints: Array.from(checkpointMap.values()),
        totalScans: assignmentData.checkpointScans.length,
        uniqueCheckpoints: checkpointMap.size
      };
    });

    // Alternative Method 2: Get detailed statistics
    const stats = await getCheckpointStatsByPoliceStation(policeStationId);

    res.status(200).json({
      success: true,
      message: `Found ${count} route assignments with checkpoint details for police station ${policeStationId}`,
      data: {
        policeStationId: parseInt(policeStationId),
        routeAssignments: transformedData,
        statistics: stats,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get checkpoints by police station error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoint details for police station',
      error: error.message,
    });
  }
};

// Helper function to get statistics - FIXED
async function getCheckpointStatsByPoliceStation(policeStationId) {
  try {
    // Method 1: Get assignment statistics using simple aggregation
    const assignmentStats = await RouteAssignment.findAll({
      where: { 
        policeStationId: parseInt(policeStationId),
        isActive: true 
      },
      attributes: [
        'status',
        [fn('COUNT', col('RouteAssignment.id')), 'count'] // Use imported fn and col
      ],
      group: ['RouteAssignment.status'],
      raw: true
    });

    // Method 2: Get scan statistics using simple counting
    const totalScans = await CheckpointScan.count({
      include: [
        {
          model: RouteAssignment,
          as: 'routeAssignment',
          where: { policeStationId: parseInt(policeStationId) },
          required: true
        }
      ]
    });

    const validScans = await CheckpointScan.count({
      where: { isValid: true },
      include: [
        {
          model: RouteAssignment,
          as: 'routeAssignment',
          where: { policeStationId: parseInt(policeStationId) },
          required: true
        }
      ]
    });

    return {
      assignmentsByStatus: assignmentStats,
      totalScans,
      validScans,
      invalidScans: totalScans - validScans,
      validityRate: totalScans > 0 ? ((validScans / totalScans) * 100).toFixed(2) : 0
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    return null;
  }
}

// Get checkpoint scans by police station
exports.getCheckpointScansByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, startDate, endDate, isValid, userId } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const whereClause = {};
    
    // Add filters
    if (startDate) {
      whereClause.scanTime = { [Op.gte]: new Date(startDate) };
    }
    if (endDate) {
      whereClause.scanTime = { 
        ...whereClause.scanTime,
        [Op.lte]: new Date(endDate) 
      };
    }
    if (isValid !== undefined) {
      whereClause.isValid = isValid === 'true';
    }
    if (userId) {
      whereClause.userId = parseInt(userId);
    }

    const { count, rows: scans } = await CheckpointScan.findAndCountAll({
      where: whereClause,
      include: [
        {
          model: RouteAssignment,
          as: 'routeAssignment',
          where: { 
            policeStationId: parseInt(policeStationId),
            isActive: true 
          },
          required: true
        },
        {
          model: Checkpoint,
          as: 'checkpoint',
          where: { isActive: true },
          required: true
        }
      ],
      order: [['scanTime', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.status(200).json({
      success: true,
      message: `Found ${count} checkpoint scans for police station ${policeStationId}`,
      data: {
        policeStationId: parseInt(policeStationId),
        checkpointScans: scans,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get checkpoint scans by police station error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoint scans for police station',
      error: error.message,
    });
  }
};