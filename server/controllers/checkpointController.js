// controllers/checkpointController.js
const Checkpoint = require('../models/Checkpoint');
const RouteAssignment = require('../models/RouteAssignment');
const Route = require('../models/Route');
const CheckpointScan = require('../models/CheckpointScan');
const QRCode = require('qrcode');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { uploadFileToS3 } = require('../middlewares/uploadMiddleware');

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
      scanRadius: 100, // Default 100 meters
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

// Update Checkpoint
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
    const { qrData, userLatLong, assignmentId, notes, userId, routeId } = req.body;

    // Input validation
    if (!userId || !qrData || !userLatLong || !assignmentId || !routeId) {
      return res.status(400).json({
        success: false,
        message: 'userId, qrData, userLatLong, assignmentId, and routeId are required',
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

    const scanRadius = checkpoint.scanRadius || 100;
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
      routeId: routeId,
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


// Get Checkpoints by Police Station ID
exports.getCheckpointsByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, search } = req.query;

    // Validate policeStationId
    if (!policeStationId || isNaN(policeStationId) || parseInt(policeStationId) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid police station ID. Must be a positive integer.',
      });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = {
      isActive: true,
      policeStationId: parseInt(policeStationId)
    };

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
      message: `Found ${count} checkpoints for police station ${policeStationId}`,
      data: {
        policeStationId: parseInt(policeStationId),
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
    console.error('Get checkpoints by police station error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch checkpoints for police station',
      error: error.message,
    });
  }
};




// FIXED BACKEND - ENHANCED FILENAME GENERATION
exports.downloadCheckpointQRCode = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'svg', size = 300 } = req.query;

    console.log(`🔄 Starting QR generation for checkpoint ID: ${id}`);

    // Validate inputs
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkpoint ID',
      });
    }

    const qrSize = parseInt(size);
    if (qrSize < 100 || qrSize > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Size must be between 100 and 1000 pixels',
      });
    }

    // Fetch checkpoint
    const checkpoint = await Checkpoint.findByPk(id);
    if (!checkpoint || !checkpoint.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Checkpoint not found',
      });
    }

    console.log(`📍 Found checkpoint: "${checkpoint.name}" (ID: ${checkpoint.id})`);

    // Fetch police station name
    const policeStationName = await getPoliceStationNameFromDatabase(checkpoint.policeStationId);

    const latLongValidation = validateLatLong(checkpoint.lat_long);
    if (!latLongValidation.valid) {
      return res.status(500).json({
        success: false,
        message: 'Invalid checkpoint coordinates',
      });
    }

    const { latitude, longitude } = latLongValidation;

    // Create QR code data
    const qrData = JSON.stringify({
      id: checkpoint.qrCode,
      name: checkpoint.name,
      lat_long: checkpoint.lat_long,
      latitude: latitude,
      longitude: longitude,
      policeStationId: checkpoint.policeStationId,
      type: 'checkpoint'
    });

    // ENHANCED FILENAME GENERATION WITH CHECKPOINT NAME
    const sanitizedCheckpointName = sanitizeFilename(checkpoint.name);
    const sanitizedStationName = sanitizeFilename(policeStationName);
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
    
    // Create descriptive filename: checkpointname_stationname_YYYY-MM-DD_qr.format
    const filename = `${sanitizedCheckpointName}_${sanitizedStationName}_${timestamp}_qr.${format}`;

    console.log(`🎯 Generating ${format.toUpperCase()} QR Code for: "${checkpoint.name}" at "${policeStationName}"`);
    console.log(`📄 Filename will be: "${filename}"`);

    if (format === 'png') {
      // Generate PNG with higher quality
      const qrBuffer = await QRCode.toBuffer(qrData, {
        type: 'png',
        width: qrSize,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'H',
        quality: 1.0
      });

      // Set proper headers for PNG download
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Checkpoint-Name', encodeURIComponent(checkpoint.name));
      res.setHeader('X-Station-Name', encodeURIComponent(policeStationName));
      res.setHeader('Cache-Control', 'no-cache');
      
      res.send(qrBuffer);

    } else {
      // Generate SVG with anti-tearing fixes
      const fixedSvg = await createAntiTearingQR(qrData, checkpoint, policeStationName, qrSize);
      
      console.log(`✅ Anti-tearing QR created for: "${checkpoint.name}" at "${policeStationName}"`);

      // Set proper headers for SVG download
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Checkpoint-Name', encodeURIComponent(checkpoint.name));
      res.setHeader('X-Station-Name', encodeURIComponent(policeStationName));
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');

      res.send(fixedSvg);
    }

  } catch (error) {
    console.error('❌ Error generating QR:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate QR code',
      error: error.message,
    });
  }
};

// ENHANCED FILENAME SANITIZATION FUNCTION
function sanitizeFilename(text) {
  if (!text) return 'unnamed';
  
  return text
    .toString()
    .toLowerCase()
    // Remove special characters and replace with underscore
    .replace(/[^\w\s-]/g, '')
    // Replace spaces and multiple spaces with single underscore
    .replace(/\s+/g, '_')
    // Replace multiple underscores with single underscore
    .replace(/_+/g, '_')
    // Remove leading/trailing underscores
    .replace(/^_|_$/g, '')
    // Limit length to 50 characters
    .slice(0, 50)
    // Ensure it's not empty
    || 'unnamed';
}

// FIXED ANTI-TEARING QR FUNCTION - RESOLVED SVG STRUCTURE ISSUES
async function createAntiTearingQR(qrData, checkpoint, policeStationName, qrSize) {
  try {
    console.log(`🔧 Creating ANTI-TEARING QR layout for: "${checkpoint.name}"`);
    
    // Generate QR as raw SVG path data instead of full SVG
    const qrCodeMatrix = await QRCode.create(qrData, {
      errorCorrectionLevel: 'H',
      width: qrSize,
      margin: 2
    });

    // Create QR squares manually to avoid SVG nesting issues
    const qrSvgPaths = generateQRPaths(qrCodeMatrix, qrSize);

    // Layout dimensions
    const padding = 50;
    const logoWidth = 140;
    const logoHeight = 100;
    const headerHeight = 140;
    const qrSpacing = 40;
    const lineHeight = 45;
    const bottomPadding = 50;
    
    const totalWidth = Math.max(qrSize + (padding * 2), 550);
    const totalHeight = headerHeight + qrSpacing + qrSize + qrSpacing + (lineHeight * 2) + bottomPadding + (padding * 2);

    // Escape text content to prevent XML issues
    const escapedCheckpointName = escapeXmlText(checkpoint.name.toUpperCase());
    const escapedPoliceStationName = escapeXmlText(policeStationName.toUpperCase());

    // Load logo
    const logoDataUrl = getLogoAsBase64();

    const antiTearingSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${totalWidth}" height="${totalHeight}" 
     viewBox="0 0 ${totalWidth} ${totalHeight}" 
     xmlns="http://www.w3.org/2000/svg" 
     xmlns:xlink="http://www.w3.org/1999/xlink"
     style="background: white;"
     shape-rendering="crispEdges"
     text-rendering="optimizeLegibility">

  <defs>
    <style type="text/css"><![CDATA[
      .crisp-text {
        font-family: 'Arial', 'Helvetica', sans-serif;
        text-rendering: optimizeLegibility;
        shape-rendering: crispEdges;
        -webkit-font-smoothing: antialiased;
      }
      .qr-container {
        shape-rendering: crispEdges;
      }
    ]]></style>
  </defs>

  <!-- Clean white background with proper borders -->
  <rect width="${totalWidth}" height="${totalHeight}" 
        fill="white" 
        stroke="#d0d7de" 
        stroke-width="2"
        rx="12"
        shape-rendering="crispEdges"/>

  <!-- Header Section -->
  <rect x="${padding}" y="${padding}" 
        width="${totalWidth - (padding * 2)}" height="${headerHeight}" 
        fill="#f8f9fa" 
        stroke="#dee2e6" 
        stroke-width="1" 
        rx="8"
        shape-rendering="crispEdges"/>

  ${logoDataUrl ? `
  <!-- Logo with proper scaling -->
  <image x="${padding + 25}" y="${padding + 20}" 
         width="${logoWidth}" height="${logoHeight}" 
         xlink:href="${logoDataUrl}"
         preserveAspectRatio="xMidYMid meet"
         style="image-rendering: auto;"/>
  ` : `
  <!-- Logo Placeholder -->
  <rect x="${padding + 25}" y="${padding + 20}" 
        width="${logoWidth}" height="${logoHeight}" 
        fill="#ffffff" 
        stroke="#1976D2" 
        stroke-width="2" 
        rx="6"
        shape-rendering="crispEdges"/>
  <text x="${padding + 25 + logoWidth/2}" y="${padding + 20 + logoHeight/2}" 
        text-anchor="middle" 
        class="crisp-text"
        font-size="14" 
        font-weight="bold" 
        fill="#1976D2"
        dominant-baseline="central">
    YOUR LOGO
  </text>
  `}

  <!-- AHILYANAGAR POLICE Text with better positioning -->
  <text x="${padding + logoWidth + 50}" y="${padding + 45}" 
        text-anchor="start" 
        class="crisp-text"
        font-size="28" 
        font-weight="bold" 
        fill="#1976D2"
        dominant-baseline="text-before-edge">
    AHILYANAGAR
  </text>
  
  <text x="${padding + logoWidth + 50}" y="${padding + 80}" 
        text-anchor="start" 
        class="crisp-text"
        font-size="24" 
        font-weight="bold" 
        fill="#1976D2"
        dominant-baseline="text-before-edge">
    POLICE
  </text>

  <!-- QR Code as native rectangles - FIXED STRUCTURE -->
  <g transform="translate(${(totalWidth - qrSize) / 2}, ${padding + headerHeight + qrSpacing})" 
     class="qr-container">
    ${qrSvgPaths}
  </g>

  <!-- Clean separator line -->
  <line x1="${padding + 30}" y1="${padding + headerHeight + qrSpacing + qrSize + 25}" 
        x2="${totalWidth - padding - 30}" y2="${padding + headerHeight + qrSpacing + qrSize + 25}" 
        stroke="#1976D2" 
        stroke-width="3"
        shape-rendering="crispEdges"/>

  <!-- Checkpoint Name with proper text rendering -->
  <text x="${totalWidth / 2}" y="${padding + headerHeight + qrSpacing + qrSize + qrSpacing + 30}" 
        text-anchor="middle" 
        class="crisp-text"
        font-size="12" 
        font-weight="bold" 
        fill="#1976D2"
        dominant-baseline="text-before-edge">
    Checkpoint name: ${escapedCheckpointName}
  </text>

  <!-- Police Station Name with proper text rendering -->
  <text x="${totalWidth / 2}" y="${padding + headerHeight + qrSpacing + qrSize + qrSpacing + 30 + lineHeight}" 
        text-anchor="middle" 
        class="crisp-text"
        font-size="18" 
        font-weight="bold" 
        fill="#1976D2"
        dominant-baseline="text-before-edge">
    Police station name: ${escapedPoliceStationName}
  </text>

</svg>`;

    console.log(`✅ Anti-tearing SVG created successfully with dimensions: ${totalWidth}x${totalHeight}`);
    return antiTearingSvg;

  } catch (error) {
    console.error('❌ Error creating anti-tearing QR:', error);
    throw error;
  }
}

// NEW FUNCTION: Generate QR paths manually to avoid SVG nesting issues
function generateQRPaths(qrMatrix, size) {
  const modules = qrMatrix.modules;
  const moduleCount = modules.size;
  const moduleSize = size / moduleCount;
  
  let paths = '';
  
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules.get(row, col)) {
        const x = col * moduleSize;
        const y = row * moduleSize;
        paths += `<rect x="${x}" y="${y}" width="${moduleSize}" height="${moduleSize}" fill="#000000" shape-rendering="crispEdges"/>`;
      }
    }
  }
  
  return paths;
}

// XML text escaping function
function escapeXmlText(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// FIXED - Enhanced police station function
async function getPoliceStationNameFromDatabase(policeStationId) {
  try {
    console.log(`🔍 Fetching police station name for ID: ${policeStationId}`);
    
    // Try database first
    try {
      const PoliceStation = require('../models/PoliceStation');
      const policeStation = await PoliceStation.findByPk(policeStationId, {
        attributes: ['id', 'name']
      });

      if (policeStation && policeStation.name) {
        console.log(`✅ Found police station from DB: "${policeStation.name}"`);
        return policeStation.name.trim().toUpperCase();
      }
    } catch (dbError) {
      console.log(`⚠️ Database fetch failed, using static mapping`);
    }
    
    // Static mapping
    const policeStations = {
      1: 'KOTWALI', 2: 'TOFFKHANA', 3: 'BHINGAR CAMP', 4: 'MIDC',
      5: 'NAGAR TALUKA', 6: 'PARNER', 7: 'SUPA', 8: 'KARJAT',
      9: 'SHRIGONDA', 10: 'BELVANDI', 11: 'JAMKHED', 12: 'KHARDA',
      13: 'MIRAJGAON', 14: 'SHEVGAON', 15: 'PATHARDI', 16: 'NEVASA',
      17: 'SONAI', 18: 'SHANI SHINGNAPUR', 19: 'SHRIRAMPUR', 20: 'SHRIRAMPUR RURAL',
      21: 'RAHURI', 22: 'KOPARGAON CITY', 23: 'KOPARGAON TALUKA', 24: 'SHIRDI',
      25: 'RAHATA', 26: 'LONI', 27: 'SANGAMNER CITY', 28: 'SANGAMNER TALUKA',
      29: 'GHARGAON', 30: 'AKOLE', 31: 'RAJUR', 32: 'ASHVI'
    };
    
    const stationName = policeStations[policeStationId];
    
    if (stationName) {
      console.log(`✅ Found police station from mapping: "${stationName}"`);
      return stationName;
    } else {
      console.log(`⚠️ Police station not found for ID: ${policeStationId}`);
      return `POLICE STATION ${policeStationId}`;
    }

  } catch (error) {
    console.error(`❌ Error fetching police station name:`, error);
    return `POLICE STATION ${policeStationId}`;
  }
}

// FIXED - Logo loading function with correct path
function getLogoAsBase64() {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Updated paths based on your project structure
    const possiblePaths = [
      path.join(process.cwd(), 'png/logo.png'),           // Project root
      path.join(__dirname, '../../png/logo.png'),        // From controllers folder
      path.join(__dirname, '../../../png/logo.png'),     // One level up
      path.join(__dirname, './png/logo.png'),            // Same directory
      path.join(process.cwd(), 'assets/png/logo.png'),   // Assets folder
      path.join(process.cwd(), 'public/png/logo.png')    // Public folder
    ];
    
    console.log('🔍 Searching for logo in paths:');
    possiblePaths.forEach((p, i) => console.log(`  ${i + 1}. ${p}`));
    
    for (const logoPath of possiblePaths) {
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        console.log(`✅ Logo found and loaded successfully from: ${logoPath}`);
        return `data:image/png;base64,${logoBuffer.toString('base64')}`;
      }
    }
    
    console.log(`❌ Logo file not found in any of the expected locations`);
    return null;
    
  } catch (error) {
    console.error('❌ Error loading logo:', error);
    return null;
  }
}