// controllers/routeController.js
const Route = require('../models/Route');
const User = require('../models/User');
const Checkpoint = require('../models/Checkpoint');
const { Op } = require('sequelize');

// Helper function to validate checkpoint IDs exist in database
const validateCheckpointIds = async (checkpointIds) => {
  const validationResult = {
    valid: true,
    invalidIds: [],
    inactiveIds: [],
    validCheckpoints: [],
    message: ''
  };

  try {
    // Convert all checkpoint IDs to integers and validate format
    const processedIds = [];
    const invalidFormatIds = [];

    for (let id of checkpointIds) {
      const numId = parseInt(id);
      if (isNaN(numId) || numId <= 0) {
        invalidFormatIds.push(id);
      } else {
        processedIds.push(numId);
      }
    }

    if (invalidFormatIds.length > 0) {
      validationResult.valid = false;
      validationResult.message = `Invalid checkpoint ID format: [${invalidFormatIds.join(', ')}]. Checkpoint IDs must be positive integers.`;
      return validationResult;
    }

    // Check for duplicate IDs
    const uniqueIds = [...new Set(processedIds)];
    if (uniqueIds.length !== processedIds.length) {
      const duplicates = processedIds.filter((id, index) => processedIds.indexOf(id) !== index);
      validationResult.valid = false;
      validationResult.message = `Duplicate checkpoint IDs found: [${[...new Set(duplicates)].join(', ')}]. Each checkpoint can only be used once in a route.`;
      return validationResult;
    }

    // Find all checkpoints with the provided IDs
    const foundCheckpoints = await Checkpoint.findAll({
      where: {
        id: {
          [Op.in]: uniqueIds
        }
      },
      attributes: ['id', 'name', 'isActive', 'lat_long', 'address']
    });

    const foundIds = foundCheckpoints.map(cp => cp.id);
    const activeCheckpoints = foundCheckpoints.filter(cp => cp.isActive);
    const inactiveCheckpoints = foundCheckpoints.filter(cp => !cp.isActive);

    // Check for non-existent checkpoint IDs
    const invalidIds = uniqueIds.filter(id => !foundIds.includes(id));
    
    // Check for inactive checkpoint IDs
    const inactiveIds = inactiveCheckpoints.map(cp => cp.id);

    if (invalidIds.length > 0) {
      validationResult.valid = false;
      validationResult.invalidIds = invalidIds;
      validationResult.message = `Checkpoint(s) not found in database: [${invalidIds.join(', ')}]. Please verify the checkpoint IDs exist.`;
      return validationResult;
    }

    if (inactiveIds.length > 0) {
      const inactiveDetails = inactiveCheckpoints.map(cp => `ID: ${cp.id} (${cp.name})`).join(', ');
      validationResult.valid = false;
      validationResult.inactiveIds = inactiveIds;
      validationResult.message = `Inactive checkpoint(s) cannot be used in routes: [${inactiveDetails}]. Please use only active checkpoints.`;
      return validationResult;
    }

    // All validations passed
    validationResult.validCheckpoints = activeCheckpoints;
    validationResult.message = `All ${activeCheckpoints.length} checkpoint(s) validated successfully.`;
    
    return validationResult;

  } catch (error) {
    validationResult.valid = false;
    validationResult.message = `Database error during checkpoint validation: ${error.message}`;
    return validationResult;
  }
};

// Helper function to validate route data
const validateRouteData = (routeData) => {
  const errors = [];

  // Validate name
  if (!routeData.name || typeof routeData.name !== 'string') {
    errors.push('Route name is required and must be a string');
  } else if (routeData.name.trim().length < 3) {
    errors.push('Route name must be at least 3 characters long');
  } else if (routeData.name.trim().length > 255) {
    errors.push('Route name cannot exceed 255 characters');
  }

  // Validate checkpoints
  if (!routeData.checkpoints) {
    errors.push('Checkpoints are required');
  } else if (!Array.isArray(routeData.checkpoints)) {
    errors.push('Checkpoints must be an array');
  } else if (routeData.checkpoints.length === 0) {
    errors.push('Route must have at least one checkpoint');
  } else if (routeData.checkpoints.length > 50) {
    errors.push('Route cannot have more than 50 checkpoints');
  }

  // Validate policeStationId
  if (!routeData.policeStationId) {
    errors.push('Police station ID is required');
  } else if (!Number.isInteger(Number(routeData.policeStationId)) || Number(routeData.policeStationId) <= 0) {
    errors.push('Police station ID must be a valid positive integer');
  }

  // Validate estimatedDuration if provided
  if (routeData.estimatedDuration !== undefined) {
    const duration = parseInt(routeData.estimatedDuration);
    if (isNaN(duration) || duration < 0) {
      errors.push('Estimated duration must be a non-negative number (in minutes)');
    } else if (duration > 1440) { // 24 hours
      errors.push('Estimated duration cannot exceed 1440 minutes (24 hours)');
    }
  }

  // Validate priority if provided
  if (routeData.priority && !['low', 'medium', 'high', 'urgent'].includes(routeData.priority)) {
    errors.push('Priority must be one of: low, medium, high, urgent');
  }

  return errors;
};

// Create Route
exports.createRoute = async (req, res) => {
  try {
    const { name, description, checkpoints, estimatedDuration, priority, createdBy, policeStationId } = req.body;

    // Basic validation
    const validationErrors = validateRouteData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Validate checkpoint IDs exist in database
    const checkpointValidation = await validateCheckpointIds(checkpoints);
    if (!checkpointValidation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Checkpoint validation failed',
        error: checkpointValidation.message,
        invalidIds: checkpointValidation.invalidIds,
        inactiveIds: checkpointValidation.inactiveIds
      });
    }

    // Check if route name already exists for the same police station
    const existingRoute = await Route.findOne({
      where: {
        name: name.trim(),
        policeStationId: Number(policeStationId),
        isActive: true
      }
    });

    if (existingRoute) {
      return res.status(409).json({
        success: false,
        message: `Route with name "${name.trim()}" already exists in police station ${policeStationId}. Please choose a different name.`
      });
    }

    // Create the route with validated checkpoint IDs
    const validCheckpointIds = checkpointValidation.validCheckpoints.map(cp => cp.id);
    
    const route = await Route.create({
      name: name.trim(),
      description: description?.trim() || null,
      checkpoints: validCheckpointIds,
      estimatedDuration: estimatedDuration || null,
      priority: priority || 'medium',
      createdBy: createdBy || 1, // Default user ID, should come from auth
      policeStationId: Number(policeStationId)
    });

    // Return detailed response with checkpoint information
    const checkpointDetails = checkpointValidation.validCheckpoints.map(cp => ({
      id: cp.id,
      name: cp.name,
      lat_long: cp.lat_long,
      address: cp.address
    }));

    res.status(201).json({
      success: true,
      message: 'Route created successfully',
      data: {
        ...route.toJSON(),
        checkpointDetails: checkpointDetails,
        totalCheckpoints: validCheckpointIds.length
      }
    });

  } catch (error) {
    console.error('Create route error:', error);
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create route',
      error: error.message,
    });
  }
};

// Get All Routes
exports.getAllRoutes = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, priority, policeStationId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const whereClause = { isActive: true };
    
    // Add search functionality
    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add priority filter
    if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
      whereClause.priority = priority;
    }

    // Add police station filter
    if (policeStationId) {
      whereClause.policeStationId = parseInt(policeStationId);
    }

    const { count, rows: routes } = await Route.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    // Get checkpoint details for each route
    const routesWithCheckpoints = await Promise.all(
      routes.map(async (route) => {
        const checkpointDetails = await Checkpoint.findAll({
          where: {
            id: {
              [Op.in]: route.checkpoints
            },
            isActive: true
          },
          attributes: ['id', 'name', 'lat_long', 'address']
        });

        return {
          ...route.toJSON(),
          checkpointDetails: checkpointDetails,
          totalCheckpoints: route.checkpoints.length,
          activeCheckpoints: checkpointDetails.length
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        routes: routesWithCheckpoints,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get routes error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch routes',
      error: error.message,
    });
  }
};

// Get Routes by Police Station ID
exports.getRoutesByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, search, priority } = req.query;
    
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
        { description: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Add priority filter
    if (priority && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
      whereClause.priority = priority;
    }

    const { count, rows: routes } = await Route.findAndCountAll({
      where: whereClause,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    // Get checkpoint details for each route
    const routesWithCheckpoints = await Promise.all(
      routes.map(async (route) => {
        const checkpointDetails = await Checkpoint.findAll({
          where: {
            id: {
              [Op.in]: route.checkpoints
            },
            isActive: true
          },
          attributes: ['id', 'name', 'lat_long', 'address']
        });

        return {
          ...route.toJSON(),
          checkpointDetails: checkpointDetails,
          totalCheckpoints: route.checkpoints.length,
          activeCheckpoints: checkpointDetails.length
        };
      })
    );

    res.status(200).json({
      success: true,
      message: `Found ${count} routes for police station ${policeStationId}`,
      data: {
        policeStationId: parseInt(policeStationId),
        routes: routesWithCheckpoints,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get routes by police station error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch routes for police station',
      error: error.message,
    });
  }
};

// Get Route by ID
exports.getRouteById = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    const route = await Route.findByPk(id);

    if (!route || !route.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    // Get checkpoint details
    const checkpointDetails = await Checkpoint.findAll({
      where: {
        id: {
          [Op.in]: route.checkpoints
        }
      },
      attributes: ['id', 'name', 'lat_long', 'address', 'isActive'],
      order: [['id', 'ASC']]
    });

    // Separate active and inactive checkpoints
    const activeCheckpoints = checkpointDetails.filter(cp => cp.isActive);
    const inactiveCheckpoints = checkpointDetails.filter(cp => !cp.isActive);
    const missingCheckpoints = route.checkpoints.filter(
      id => !checkpointDetails.find(cp => cp.id === id)
    );

    // Warn if there are issues with checkpoints
    const warnings = [];
    if (inactiveCheckpoints.length > 0) {
      warnings.push(`${inactiveCheckpoints.length} checkpoint(s) are inactive`);
    }
    if (missingCheckpoints.length > 0) {
      warnings.push(`${missingCheckpoints.length} checkpoint(s) no longer exist`);
    }

    res.status(200).json({
      success: true,
      data: {
        ...route.toJSON(),
        checkpointDetails: checkpointDetails,
        checkpointSummary: {
          total: route.checkpoints.length,
          active: activeCheckpoints.length,
          inactive: inactiveCheckpoints.length,
          missing: missingCheckpoints.length
        },
        warnings: warnings
      }
    });

  } catch (error) {
    console.error('Get route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch route',
      error: error.message,
    });
  }
};

// Update Route
exports.updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate ID format
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    const route = await Route.findByPk(id);
    if (!route || !route.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
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

    // Validate update data
    const validationErrors = validateRouteData({ ...route.toJSON(), ...updateData });
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // If checkpoints are being updated, validate them
    if (updateData.checkpoints) {
      const checkpointValidation = await validateCheckpointIds(updateData.checkpoints);
      if (!checkpointValidation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Checkpoint validation failed',
          error: checkpointValidation.message,
          invalidIds: checkpointValidation.invalidIds,
          inactiveIds: checkpointValidation.inactiveIds
        });
      }
      // Use validated checkpoint IDs
      updateData.checkpoints = checkpointValidation.validCheckpoints.map(cp => cp.id);
    }

    // Check if new name conflicts with existing routes (if name is being updated)
    if (updateData.name && updateData.name.trim() !== route.name) {
      const policeStationIdToCheck = updateData.policeStationId || route.policeStationId;
      const existingRoute = await Route.findOne({
        where: {
          name: updateData.name.trim(),
          policeStationId: policeStationIdToCheck,
          isActive: true,
          id: { [Op.ne]: id } // Exclude current route
        }
      });

      if (existingRoute) {
        return res.status(409).json({
          success: false,
          message: `Route with name "${updateData.name.trim()}" already exists in police station ${policeStationIdToCheck}. Please choose a different name.`
        });
      }
    }

    // Clean up update data
    const cleanUpdateData = {
      ...updateData,
      name: updateData.name?.trim(),
      description: updateData.description?.trim()
    };

    await route.update(cleanUpdateData);

    // Get updated checkpoint details if checkpoints were modified
    let checkpointDetails = [];
    if (updateData.checkpoints) {
      checkpointDetails = await Checkpoint.findAll({
        where: {
          id: {
            [Op.in]: route.checkpoints
          }
        },
        attributes: ['id', 'name', 'lat_long', 'address']
      });
    }

    res.status(200).json({
      success: true,
      message: 'Route updated successfully',
      data: {
        ...route.toJSON(),
        ...(checkpointDetails.length > 0 && { checkpointDetails })
      }
    });

  } catch (error) {
    console.error('Update route error:', error);
    
    // Handle Sequelize validation errors
    if (error.name === 'SequelizeValidationError') {
      const validationErrors = error.errors.map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update route',
      error: error.message,
    });
  }
};

// Delete Route (Soft delete)
exports.deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ID format
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID format'
      });
    }

    const route = await Route.findByPk(id);
    if (!route || !route.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    }

    // Check if route is currently being used in active assignments
    // This would require checking RouteAssignment model if it exists
    // const activeAssignments = await RouteAssignment.findAll({
    //   where: {
    //     routeId: id,
    //     status: 'in_progress'
    //   }
    // });
    // 
    // if (activeAssignments.length > 0) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Cannot delete route that has active assignments'
    //   });
    // }

    await route.update({ isActive: false });

    res.status(200).json({
      success: true,
      message: 'Route deleted successfully'
    });

  } catch (error) {
    console.error('Delete route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete route',
      error: error.message,
    });
  }
};

// Validate Route Checkpoints (separate endpoint for testing)
exports.validateRouteCheckpoints = async (req, res) => {
  try {
    const { checkpoints } = req.body;

    if (!checkpoints || !Array.isArray(checkpoints)) {
      return res.status(400).json({
        success: false,
        message: 'Checkpoints array is required'
      });
    }

    const validation = await validateCheckpointIds(checkpoints);

    res.status(200).json({
      success: validation.valid,
      message: validation.message,
      data: {
        valid: validation.valid,
        totalProvided: checkpoints.length,
        validCheckpoints: validation.validCheckpoints.length,
        invalidIds: validation.invalidIds,
        inactiveIds: validation.inactiveIds,
        checkpointDetails: validation.validCheckpoints
      }
    });

  } catch (error) {
    console.error('Validate checkpoints error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate checkpoints',
      error: error.message,
    });
  }
};