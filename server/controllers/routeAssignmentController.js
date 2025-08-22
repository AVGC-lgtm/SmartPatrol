// controllers/routeAssignmentController.js - COMPLETE CONTROLLER
const RouteAssignment = require('../models/RouteAssignment');
const User = require('../models/User');
const Route = require('../models/Route');
const Checkpoint = require('../models/Checkpoint');
const CheckpointScan = require('../models/CheckpointScan');

const { Op } = require('sequelize');

// Helper function to get detailed checkpoint information
const getDetailedCheckpointInfo = async (route, completedCheckpointIds = []) => {
  if (!route || !route.checkpoints || route.checkpoints.length === 0) {
    return {
      checkpointDetails: [],
      checkpointSummary: {
        total: 0,
        completed: 0,
        pending: 0,
        completionRate: 0
      }
    };
  }

  // Get all checkpoint details
  const checkpointDetails = await Checkpoint.findAll({
    where: {
      id: { [Op.in]: route.checkpoints }
    },
    order: [['id', 'ASC']]
  });

  // Enhance checkpoints with completion status and order
  const enhancedCheckpoints = checkpointDetails.map((checkpoint, index) => {
    const isCompleted = completedCheckpointIds.includes(checkpoint.id);
    const order = route.checkpoints.indexOf(checkpoint.id) + 1;

    return {
      id: checkpoint.id,
      name: checkpoint.name,
      description: checkpoint.description || null,
      lat_long: checkpoint.lat_long,
      address: checkpoint.address || null,
      scanRadius: checkpoint.scanRadius || 50,
      isActive: checkpoint.isActive,
      qrCode: checkpoint.qrCode || null,
      qrCodeUrl: checkpoint.qrCodeUrl || null,
      order: order,
      status: {
        isCompleted: isCompleted,
        completedAt: null, // Would need to track this in checkpoint scan logs
        isPending: !isCompleted,
        isNext: !isCompleted && completedCheckpointIds.length === (order - 1)
      },
      coordinates: {
        latitude: checkpoint.lat_long ? parseFloat(checkpoint.lat_long.split(',')[0]) : null,
        longitude: checkpoint.lat_long ? parseFloat(checkpoint.lat_long.split(',')[1]) : null
      },
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt
    };
  });

  // Sort by route order
  enhancedCheckpoints.sort((a, b) => a.order - b.order);

  const completedCount = enhancedCheckpoints.filter(cp => cp.status.isCompleted).length;
  const totalCount = enhancedCheckpoints.length;

  return {
    checkpointDetails: enhancedCheckpoints,
    checkpointSummary: {
      total: totalCount,
      completed: completedCount,
      pending: totalCount - completedCount,
      completionRate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      nextCheckpoint: enhancedCheckpoints.find(cp => cp.status.isNext) || null,
      lastCompleted: enhancedCheckpoints.filter(cp => cp.status.isCompleted).pop() || null
    }
  };
};

// Assign Route to User - Simplified version
exports.assignRoute = async (req, res) => {
  try {
    const { routeId, userId, policeStationId } = req.body;

    // Input validation
    if (!routeId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Route ID and User ID are required',
      });
    }

    // Check if user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Check if route exists and is active
    const route = await Route.findByPk(routeId);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    if (!route.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Route is not active',
      });
    }

    // RULE 1: Check if this route is already assigned to ANY user
    const existingRouteAssignment = await RouteAssignment.findOne({
      where: {
        routeId: routeId,
        isActive: true,
        status: { [Op.in]: ['assigned', 'in_progress'] }
      }
    });

    if (existingRouteAssignment) {
      const assignedUser = await User.findByPk(existingRouteAssignment.userId);
      
      return res.status(409).json({
        success: false,
        message: `Route "${route.name}" is already assigned to another user`,
        error: 'ROUTE_ALREADY_ASSIGNED',
        data: {
          route: {
            id: route.id,
            name: route.name
          },
          assignedTo: {
            id: assignedUser.id,
            username: assignedUser.username || `User_${assignedUser.id}`
          },
          assignmentId: existingRouteAssignment.id,
          assignedAt: existingRouteAssignment.createdAt,
          status: existingRouteAssignment.status,
          suggestion: 'Please choose a different route or wait for the current assignment to be completed/cancelled'
        }
      });
    }

    // RULE 2: Check if user already has this specific route assigned
    const userRouteConflict = await RouteAssignment.findOne({
      where: {
        userId: userId,
        routeId: routeId,
        isActive: true,
        status: { [Op.in]: ['assigned', 'in_progress'] }
      }
    });

    if (userRouteConflict) {
      return res.status(409).json({
        success: false,
        message: 'User already has this route assigned',
        error: 'USER_ROUTE_DUPLICATE',
        data: {
          existingAssignment: {
            id: userRouteConflict.id,
            status: userRouteConflict.status,
            assignedAt: userRouteConflict.createdAt
          }
        }
      });
    }

    // RULE 3: Check user's active assignment limit
    const userActiveAssignments = await RouteAssignment.findAll({
      where: {
        userId: userId,
        isActive: true,
        status: { [Op.in]: ['assigned', 'in_progress'] }
      }
    });

    const MAX_ROUTES_PER_USER = 5;
    if (userActiveAssignments.length >= MAX_ROUTES_PER_USER) {
      return res.status(400).json({
        success: false,
        message: `User has reached the maximum limit of ${MAX_ROUTES_PER_USER} active route assignments`,
        error: 'MAX_ROUTES_REACHED',
        data: {
          currentActiveRoutes: userActiveAssignments.length,
          maxAllowed: MAX_ROUTES_PER_USER,
          suggestion: 'Complete or cancel existing routes before assigning new ones'
        }
      });
    }

    // Create the assignment
    const assignment = await RouteAssignment.create({
      userId,
      routeId,
      policeStationId,
      startDate: new Date(),
      status: 'assigned',
      completedCheckpoints: [],
      notes: `Route assigned at ${new Date().toLocaleString()}`
    });

    const userRouteCount = userActiveAssignments.length + 1;

    res.status(201).json({
      success: true,
      message: 'Route assigned successfully',
      data: {
        assignment,
        route: {
          id: route.id,
          name: route.name,
          description: route.description,
          totalCheckpoints: route.checkpoints ? route.checkpoints.length : 0
        },
        user: {
          id: user.id,
          username: user.username || `User_${user.id}`
        },
        userStats: {
          totalActiveAssignments: userRouteCount,
          maxAllowed: MAX_ROUTES_PER_USER,
          remainingSlots: MAX_ROUTES_PER_USER - userRouteCount
        }
      }
    });
  } catch (error) {
    console.error('Assign route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign route',
      error: error.message,
    });
  }
};

// Get All Route Assignments
exports.getAllAssignments = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, userId, routeId } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const whereClause = { isActive: true };

    if (status) {
      whereClause.status = status;
    }
    if (userId) {
      whereClause.userId = userId;
    }
    if (routeId) {
      whereClause.routeId = routeId;
    }

    const { count, rows: assignments } = await RouteAssignment.findAndCountAll({
      where: whereClause,
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    const assignmentsWithDetails = await Promise.all(
      assignments.map(async (assignment) => {
        const user = await User.findByPk(assignment.userId);
        const route = await Route.findByPk(assignment.routeId);
        
        const totalCheckpoints = route?.checkpoints?.length || 0;
        const completedCheckpoints = assignment.completedCheckpoints?.length || 0;
        
        return {
          ...assignment.toJSON(),
          user: user ? {
            id: user.id,
            username: user.username || `User_${user.id}`
          } : null,
          route: route ? {
            id: route.id,
            name: route.name,
            description: route.description
          } : null,
          progress: {
            total: totalCheckpoints,
            completed: completedCheckpoints,
            percentage: totalCheckpoints > 0 ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0,
            remaining: totalCheckpoints - completedCheckpoints
          }
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        assignments: assignmentsWithDetails,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments',
      error: error.message,
    });
  }
};

// Get Route Assignments by Police Station ID
exports.getAssignmentsByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (!policeStationId || isNaN(policeStationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid police station ID',
      });
    }

    const whereClause = {
      policeStationId: policeStationId,
      isActive: true
    };

    if (status) {
      whereClause.status = status;
    }

    const { count, rows: assignments } = await RouteAssignment.findAndCountAll({
      where: whereClause,
      order: [['id', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    const assignmentsWithDetails = await Promise.all(
      assignments.map(async (assignment) => {
        const user = await User.findByPk(assignment.userId);
        const route = await Route.findByPk(assignment.routeId);
        
        const totalCheckpoints = route?.checkpoints?.length || 0;
        const completedCheckpoints = assignment.completedCheckpoints?.length || 0;
        
        return {
          ...assignment.toJSON(),
          user: user ? {
            id: user.id,
            username: user.username || `User_${user.id}`,
            // Add only the 4 specific fields
            smartusername: user.smartusername,
            smartuseremail: user.smartuseremail,
            smartuserphone: user.smartuserphone,
            smartuserrank: user.smartuserrank
          } : null,
          route: route ? {
            id: route.id,
            name: route.name,
            description: route.description
          } : null,
          progress: {
            total: totalCheckpoints,
            completed: completedCheckpoints,
            percentage: totalCheckpoints > 0 ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0,
            remaining: totalCheckpoints - completedCheckpoints
          }
        };
      })
    );

    // Calculate statistics for this police station
    const stats = {
      total: count,
      byStatus: {
        assigned: assignmentsWithDetails.filter(a => a.status === 'assigned').length,
        inProgress: assignmentsWithDetails.filter(a => a.status === 'in_progress').length,
        completed: assignmentsWithDetails.filter(a => a.status === 'completed').length,
        cancelled: assignmentsWithDetails.filter(a => a.status === 'cancelled').length
      },
      progress: {
        totalCheckpoints: assignmentsWithDetails.reduce((sum, a) => sum + a.progress.total, 0),
        completedCheckpoints: assignmentsWithDetails.reduce((sum, a) => sum + a.progress.completed, 0),
        overallProgress: assignmentsWithDetails.length > 0 ? 
          Math.round(assignmentsWithDetails.reduce((sum, a) => sum + a.progress.percentage, 0) / assignmentsWithDetails.length) : 0
      }
    };

    res.status(200).json({
      success: true,
      message: 'Police station assignments retrieved successfully',
      data: {
        policeStationId: parseInt(policeStationId),
        assignments: assignmentsWithDetails,
        stats: stats,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get assignments by police station error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignments by police station',
      error: error.message,
    });
  }
};
// Get Assignment by ID
exports.getAssignmentById = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findByPk(id);

    if (!assignment || !assignment.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    const user = await User.findByPk(assignment.userId, {
      attributes: { exclude: ['password'] }
    });
    const route = await Route.findByPk(assignment.routeId);

    let checkpointDetails = [];
    if (route && route.checkpoints) {
      checkpointDetails = await Checkpoint.findAll({
        where: { 
          id: { [Op.in]: route.checkpoints },
          isActive: true 
        },
      });
    }

    const totalCheckpoints = route?.checkpoints?.length || 0;
    const completedCheckpoints = assignment.completedCheckpoints?.length || 0;

    res.status(200).json({
      success: true,
      data: {
        ...assignment.toJSON(),
        user,
        route,
        checkpointDetails,
        progress: {
          total: totalCheckpoints,
          completed: completedCheckpoints,
          percentage: totalCheckpoints > 0 ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0,
          remaining: totalCheckpoints - completedCheckpoints
        }
      },
    });
  } catch (error) {
    console.error('Get assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch assignment',
      error: error.message,
    });
  }
};

// Get User's Route Assignments (Original) - ENHANCED WITH FULL CHECKPOINT DETAILS
exports.getUserAssignments = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, includeCompleted = false } = req.query;

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID',
      });
    }

    // Check if user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const whereClause = {
      userId,
      isActive: true,
    };

    if (status) {
      whereClause.status = status;
    } else if (!includeCompleted) {
      // By default, exclude completed and cancelled assignments
      whereClause.status = { [Op.in]: ['assigned', 'in_progress'] };
    }

    const assignments = await RouteAssignment.findAll({
      where: whereClause,
      order: [['id', 'DESC']],
    });

    // Get route details and full checkpoint information for each assignment
    const assignmentsWithFullDetails = await Promise.all(
      assignments.map(async (assignment) => {
        const route = await Route.findByPk(assignment.routeId);
        const completedCheckpointIds = assignment.completedCheckpoints || [];

        // Get detailed checkpoint information
        const checkpointInfo = await getDetailedCheckpointInfo(route, completedCheckpointIds);

        return {
          // Assignment basic info
          id: assignment.id,
          userId: assignment.userId,
          routeId: assignment.routeId,
          status: assignment.status,
          startDate: assignment.startDate,
          endDate: assignment.endDate,
          notes: assignment.notes,
          completedCheckpoints: completedCheckpointIds,
          isActive: assignment.isActive,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,

          // Route information
          route: route ? {
            id: route.id,
            name: route.name,
            description: route.description,
            estimatedDuration: route.estimatedDuration,
            priority: route.priority || 'medium',
            isActive: route.isActive,
            totalCheckpoints: route.checkpoints?.length || 0,
            checkpointIds: route.checkpoints || []
          } : null,

          // Complete checkpoint details
          checkpoints: checkpointInfo.checkpointDetails,
          checkpointSummary: checkpointInfo.checkpointSummary,

          // Progress information
          progress: {
            total: checkpointInfo.checkpointSummary.total,
            completed: checkpointInfo.checkpointSummary.completed,
            pending: checkpointInfo.checkpointSummary.pending,
            percentage: checkpointInfo.checkpointSummary.completionRate,
            nextCheckpoint: checkpointInfo.checkpointSummary.nextCheckpoint,
            lastCompleted: checkpointInfo.checkpointSummary.lastCompleted
          },

          // Action capabilities
          actions: {
            canStart: assignment.status === 'assigned',
            canComplete: assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.completed === checkpointInfo.checkpointSummary.total,
            canCancel: ['assigned', 'in_progress'].includes(assignment.status),
            canScanCheckpoint: assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.pending > 0,
            recommendedAction: assignment.status === 'assigned' ? 'start_route' :
                              assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.pending > 0 ? 'scan_next_checkpoint' :
                              assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.pending === 0 ? 'complete_route' :
                              'none'
          },

          // Status information
          statusInfo: {
            isActive: ['assigned', 'in_progress'].includes(assignment.status),
            isFinished: ['completed', 'cancelled'].includes(assignment.status),
            statusDisplay: assignment.status.charAt(0).toUpperCase() + assignment.status.slice(1).replace('_', ' '),
            priorityLevel: route?.priority || 'medium'
          }
        };
      })
    );

    // Calculate user statistics
    const activeAssignments = assignmentsWithFullDetails.filter(a => 
      ['assigned', 'in_progress'].includes(a.status)
    );

    const userStats = {
      summary: {
        totalAssignments: assignmentsWithFullDetails.length,
        activeAssignments: activeAssignments.length,
        assignedRoutes: assignmentsWithFullDetails.filter(a => a.status === 'assigned').length,
        inProgressRoutes: assignmentsWithFullDetails.filter(a => a.status === 'in_progress').length,
        completedRoutes: assignmentsWithFullDetails.filter(a => a.status === 'completed').length,
        cancelledRoutes: assignmentsWithFullDetails.filter(a => a.status === 'cancelled').length
      },
      checkpoints: {
        totalCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.total, 0),
        completedCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.completed, 0),
        pendingCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.pending, 0),
        overallProgress: assignmentsWithFullDetails.length > 0 ?
          Math.round(assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.percentage, 0) / assignmentsWithFullDetails.length) : 0
      },
      capacity: {
        maxAllowed: 5,
        currentActive: activeAssignments.length,
        availableSlots: 5 - activeAssignments.length,
        canAcceptNewAssignments: activeAssignments.length < 5,
        utilizationRate: Math.round((activeAssignments.length / 5) * 100)
      },
      actionItems: {
        routesToStart: assignmentsWithFullDetails.filter(a => a.actions.canStart).length,
        routesToComplete: assignmentsWithFullDetails.filter(a => a.actions.canComplete).length,
        checkpointsToScan: assignmentsWithFullDetails.filter(a => a.actions.canScanCheckpoint).length,
        urgentActions: assignmentsWithFullDetails.filter(a => 
          a.actions.recommendedAction !== 'none' && a.statusInfo.priorityLevel === 'high'
        ).length
      }
    };

    res.status(200).json({
      success: true,
      message: 'User assignments with full checkpoint details retrieved successfully',
      data: {
        user: {
          id: user.id,
          username: user.username || `User_${user.id}`,
          ...(user.email && { email: user.email }),
          ...(user.name && { name: user.name })
        },
        assignments: assignmentsWithFullDetails,
        stats: userStats,
        filters: {
          status: status || 'active_only',
          includeCompleted: includeCompleted
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          totalRecords: assignmentsWithFullDetails.length,
          dataIncludes: [
            'full_checkpoint_details',
            'progress_tracking',
            'action_recommendations',
            'comprehensive_stats'
          ]
        }
      }
    });
  } catch (error) {
    console.error('Get user assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user assignments',
      error: error.message,
    });
  }
};

// Get ALL User's Route Assignments (regardless of status) - WITH FULL CHECKPOINT DETAILS
exports.getAllUserAssignments = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'id', 
      sortOrder = 'DESC',
      includeInactive = false 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID',
      });
    }

    // Check if user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Get all assignments for the user
    const whereClause = {
      userId,
      isActive: true,
    };

    const { count, rows: assignments } = await RouteAssignment.findAndCountAll({
      where: whereClause,
      order: [[sortBy, sortOrder]],
      limit: parseInt(limit),
      offset: offset
    });

    // Get detailed information for each assignment including full checkpoint details
    const assignmentsWithFullDetails = await Promise.all(
      assignments.map(async (assignment) => {
        const route = await Route.findByPk(assignment.routeId);
        const completedCheckpointIds = assignment.completedCheckpoints || [];

        // Get detailed checkpoint information
        const checkpointInfo = await getDetailedCheckpointInfo(route, completedCheckpointIds);

        // Calculate timing information
        const startTime = assignment.startDate ? new Date(assignment.startDate) : null;
        const endTime = assignment.endDate ? new Date(assignment.endDate) : null;
        const currentTime = new Date();

        let durationInfo = {};
        if (startTime && endTime) {
          const durationMs = endTime - startTime;
          durationInfo = {
            totalMinutes: Math.round(durationMs / (1000 * 60)),
            totalHours: Math.round(durationMs / (1000 * 60 * 60) * 100) / 100,
            formatted: `${Math.floor(durationMs / (1000 * 60 * 60))}h ${Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60))}m`
          };
        } else if (startTime && assignment.status === 'in_progress') {
          const elapsedMs = currentTime - startTime;
          durationInfo = {
            elapsedMinutes: Math.round(elapsedMs / (1000 * 60)),
            elapsedHours: Math.round(elapsedMs / (1000 * 60 * 60) * 100) / 100,
            elapsedFormatted: `${Math.floor(elapsedMs / (1000 * 60 * 60))}h ${Math.floor((elapsedMs % (1000 * 60 * 60)) / (1000 * 60))}m`,
            isOngoing: true
          };
        }

        return {
          // Assignment details
          assignment: {
            id: assignment.id,
            userId: assignment.userId,
            routeId: assignment.routeId,
            status: assignment.status,
            startDate: assignment.startDate,
            endDate: assignment.endDate,
            notes: assignment.notes,
            completedCheckpoints: completedCheckpointIds,
            isActive: assignment.isActive,
            createdAt: assignment.createdAt,
            updatedAt: assignment.updatedAt
          },

          // Route details
          route: route ? {
            id: route.id,
            name: route.name,
            description: route.description,
            estimatedDuration: route.estimatedDuration,
            priority: route.priority || 'medium',
            isActive: route.isActive,
            createdBy: route.createdBy,
            totalCheckpoints: route.checkpoints?.length || 0,
            checkpointIds: route.checkpoints || [],
            createdAt: route.createdAt,
            updatedAt: route.updatedAt
          } : null,

          // Detailed checkpoint information
          checkpoints: checkpointInfo.checkpointDetails,
          checkpointSummary: checkpointInfo.checkpointSummary,

          // Progress and status information
          progress: {
            total: checkpointInfo.checkpointSummary.total,
            completed: checkpointInfo.checkpointSummary.completed,
            pending: checkpointInfo.checkpointSummary.pending,
            percentage: checkpointInfo.checkpointSummary.completionRate,
            nextCheckpoint: checkpointInfo.checkpointSummary.nextCheckpoint,
            lastCompleted: checkpointInfo.checkpointSummary.lastCompleted
          },

          // Status and action information
          statusInfo: {
            canStart: assignment.status === 'assigned',
            canComplete: assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.completed === checkpointInfo.checkpointSummary.total,
            canCancel: ['assigned', 'in_progress'].includes(assignment.status),
            isActive: ['assigned', 'in_progress'].includes(assignment.status),
            isFinished: ['completed', 'cancelled'].includes(assignment.status),
            canScanCheckpoint: assignment.status === 'in_progress' && checkpointInfo.checkpointSummary.pending > 0
          },

          // Timeline and duration information
          timeline: {
            assigned: assignment.createdAt,
            started: assignment.startDate,
            completed: assignment.endDate,
            lastUpdated: assignment.updatedAt,
            duration: durationInfo
          },

          // Performance metrics
          performance: {
            isFullyCompleted: checkpointInfo.checkpointSummary.completed === checkpointInfo.checkpointSummary.total,
            completionRate: checkpointInfo.checkpointSummary.completionRate,
            efficiency: route?.estimatedDuration && durationInfo.totalMinutes ? 
              Math.round((route.estimatedDuration / durationInfo.totalMinutes) * 100) : null,
            wasForceCompleted: assignment.notes?.includes('Force completed') || false
          }
        };
      })
    );

    // Calculate comprehensive statistics
    const stats = {
      total: {
        allAssignments: assignmentsWithFullDetails.length,
        activeAssignments: assignmentsWithFullDetails.filter(a => ['assigned', 'in_progress'].includes(a.assignment.status)).length,
        finishedAssignments: assignmentsWithFullDetails.filter(a => ['completed', 'cancelled'].includes(a.assignment.status)).length
      },
      byStatus: {
        assigned: assignmentsWithFullDetails.filter(a => a.assignment.status === 'assigned').length,
        inProgress: assignmentsWithFullDetails.filter(a => a.assignment.status === 'in_progress').length,
        completed: assignmentsWithFullDetails.filter(a => a.assignment.status === 'completed').length,
        cancelled: assignmentsWithFullDetails.filter(a => a.assignment.status === 'cancelled').length
      },
      checkpoints: {
        totalCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.total, 0),
        completedCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.completed, 0),
        pendingCheckpoints: assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.pending, 0),
        overallCompletionRate: assignmentsWithFullDetails.length > 0 ? 
          Math.round(assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.percentage, 0) / assignmentsWithFullDetails.length) : 0
      },
      performance: {
        completionRate: assignmentsWithFullDetails.length > 0 ? 
          Math.round((assignmentsWithFullDetails.filter(a => a.assignment.status === 'completed').length / assignmentsWithFullDetails.length) * 100) : 0,
        averageProgress: assignmentsWithFullDetails.length > 0 ?
          Math.round(assignmentsWithFullDetails.reduce((sum, a) => sum + a.progress.percentage, 0) / assignmentsWithFullDetails.length) : 0,
        fullyCompletedRoutes: assignmentsWithFullDetails.filter(a => a.performance.isFullyCompleted).length,
        averageEfficiency: assignmentsWithFullDetails.filter(a => a.performance.efficiency).length > 0 ?
          Math.round(assignmentsWithFullDetails.filter(a => a.performance.efficiency).reduce((sum, a) => sum + a.performance.efficiency, 0) / 
            assignmentsWithFullDetails.filter(a => a.performance.efficiency).length) : null
      },
      limits: {
        maxAllowed: 5,
        currentActive: assignmentsWithFullDetails.filter(a => ['assigned', 'in_progress'].includes(a.assignment.status)).length,
        canAcceptNew: assignmentsWithFullDetails.filter(a => ['assigned', 'in_progress'].includes(a.assignment.status)).length < 5,
        utilizationRate: Math.round((assignmentsWithFullDetails.filter(a => ['assigned', 'in_progress'].includes(a.assignment.status)).length / 5) * 100)
      }
    };

    res.status(200).json({
      success: true,
      message: 'All user assignments with full checkpoint details retrieved successfully',
      data: {
        user: {
          id: user.id,
          username: user.username || `User_${user.id}`,
          // Add any other user fields that exist
          ...(user.email && { email: user.email }),
          ...(user.name && { name: user.name })
        },
        assignments: assignmentsWithFullDetails,
        stats: stats,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        },
        metadata: {
          sortBy,
          sortOrder,
          includeInactive,
          generatedAt: new Date().toISOString()
        }
      }
    });
  } catch (error) {
    console.error('Get all user assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch all user assignments',
      error: error.message,
    });
  }
};

// Get User's COMPLETED Route Assignments Only - WITH FULL CHECKPOINT DETAILS
exports.getUserCompletedAssignments = async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      page = 1, 
      limit = 10, 
      sortBy = 'endDate', 
      sortOrder = 'DESC',
      fromDate,
      toDate 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID',
      });
    }

    // Check if user exists
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Build where clause for completed assignments
    const whereClause = {
      userId,
      isActive: true,
      status: 'completed'
    };

    // Add date range filter if provided
    if (fromDate || toDate) {
      whereClause.endDate = {};
      if (fromDate) {
        whereClause.endDate[Op.gte] = new Date(fromDate);
      }
      if (toDate) {
        const toDateEnd = new Date(toDate);
        toDateEnd.setHours(23, 59, 59, 999);
        whereClause.endDate[Op.lte] = toDateEnd;
      }
    }

    const { count, rows: completedAssignments } = await RouteAssignment.findAndCountAll({
      where: whereClause,
      order: [[sortBy, sortOrder]],
      limit: parseInt(limit),
      offset: offset
    });

    // Get detailed information for each completed assignment
    const completedWithFullDetails = await Promise.all(
      completedAssignments.map(async (assignment) => {
        const route = await Route.findByPk(assignment.routeId);
        const completedCheckpointIds = assignment.completedCheckpoints || [];

        // Get detailed checkpoint information
        const checkpointInfo = await getDetailedCheckpointInfo(route, completedCheckpointIds);
        
        // Calculate completion time and performance metrics
        const startTime = assignment.startDate ? new Date(assignment.startDate) : null;
        const endTime = assignment.endDate ? new Date(assignment.endDate) : null;
        const completionTimeMinutes = startTime && endTime ? 
          Math.round((endTime - startTime) / (1000 * 60)) : null;

        return {
          // Assignment details
          assignment: {
            id: assignment.id,
            userId: assignment.userId,
            routeId: assignment.routeId,
            status: assignment.status,
            startDate: assignment.startDate,
            endDate: assignment.endDate,
            notes: assignment.notes,
            completedCheckpoints: completedCheckpointIds,
            isActive: assignment.isActive,
            createdAt: assignment.createdAt,
            updatedAt: assignment.updatedAt
          },

          // Route details
          route: route ? {
            id: route.id,
            name: route.name,
            description: route.description,
            estimatedDuration: route.estimatedDuration,
            priority: route.priority || 'medium',
            isActive: route.isActive,
            createdBy: route.createdBy,
            totalCheckpoints: route.checkpoints?.length || 0,
            checkpointIds: route.checkpoints || [],
            createdAt: route.createdAt,
            updatedAt: route.updatedAt
          } : null,

          // Detailed checkpoint information (all marked as completed for completed assignments)
          checkpoints: checkpointInfo.checkpointDetails,
          checkpointSummary: checkpointInfo.checkpointSummary,

          // Completion details and performance
          completionDetails: {
            totalCheckpoints: checkpointInfo.checkpointSummary.total,
            completedCheckpoints: checkpointInfo.checkpointSummary.completed,
            completionRate: checkpointInfo.checkpointSummary.completionRate,
            allCheckpointsCompleted: checkpointInfo.checkpointSummary.completed === checkpointInfo.checkpointSummary.total,
            completionTime: {
              minutes: completionTimeMinutes,
              hours: completionTimeMinutes ? Math.round(completionTimeMinutes / 60 * 100) / 100 : null,
              formatted: completionTimeMinutes ? 
                `${Math.floor(completionTimeMinutes / 60)}h ${completionTimeMinutes % 60}m` : null
            },
            checkpointsPerHour: completionTimeMinutes && checkpointInfo.checkpointSummary.completed > 0 ?
              Math.round((checkpointInfo.checkpointSummary.completed / (completionTimeMinutes / 60)) * 100) / 100 : null
          },

          // Timeline information
          timeline: {
            assigned: assignment.createdAt,
            started: assignment.startDate,
            completed: assignment.endDate,
            totalDuration: completionTimeMinutes,
            assignmentToStartDelay: startTime && assignment.createdAt ? 
              Math.round((startTime - new Date(assignment.createdAt)) / (1000 * 60)) : null
          },

          // Performance analysis
          performance: {
            isFullyCompleted: checkpointInfo.checkpointSummary.completed === checkpointInfo.checkpointSummary.total,
            wasForceCompleted: assignment.notes?.includes('Force completed') || false,
            efficiency: route?.estimatedDuration && completionTimeMinutes ? 
              Math.round((route.estimatedDuration / completionTimeMinutes) * 100) : null,
            rating: checkpointInfo.checkpointSummary.completionRate >= 100 ? 'Excellent' :
                   checkpointInfo.checkpointSummary.completionRate >= 80 ? 'Good' :
                   checkpointInfo.checkpointSummary.completionRate >= 60 ? 'Average' : 'Poor',
            speedMetrics: {
              averageTimePerCheckpoint: completionTimeMinutes && checkpointInfo.checkpointSummary.completed > 0 ?
                Math.round(completionTimeMinutes / checkpointInfo.checkpointSummary.completed) : null,
              checkpointsPerHour: completionTimeMinutes && checkpointInfo.checkpointSummary.completed > 0 ?
                Math.round((checkpointInfo.checkpointSummary.completed / (completionTimeMinutes / 60)) * 100) / 100 : null
            }
          }
        };
      })
    );

    // Calculate comprehensive completion statistics
    const completionStats = {
      total: {
        completedAssignments: completedWithFullDetails.length,
        totalCheckpointsInRoutes: completedWithFullDetails.reduce((sum, a) => sum + a.completionDetails.totalCheckpoints, 0),
        totalCheckpointsCompleted: completedWithFullDetails.reduce((sum, a) => sum + a.completionDetails.completedCheckpoints, 0),
        totalCompletionTime: completedWithFullDetails.reduce((sum, a) => sum + (a.completionDetails.completionTime.minutes || 0), 0)
      },
      performance: {
        averageCompletionRate: completedWithFullDetails.length > 0 ?
          Math.round(completedWithFullDetails.reduce((sum, a) => sum + a.completionDetails.completionRate, 0) / completedWithFullDetails.length) : 0,
        fullyCompletedRoutes: completedWithFullDetails.filter(a => a.performance.isFullyCompleted).length,
        forceCompletedRoutes: completedWithFullDetails.filter(a => a.performance.wasForceCompleted).length,
        averageCompletionTime: {
          minutes: completedWithFullDetails.filter(a => a.completionDetails.completionTime.minutes).length > 0 ? 
            Math.round(completedWithFullDetails
              .filter(a => a.completionDetails.completionTime.minutes)
              .reduce((sum, a) => sum + a.completionDetails.completionTime.minutes, 0) / 
              completedWithFullDetails.filter(a => a.completionDetails.completionTime.minutes).length) : 0,
          hours: null
        },
        averageEfficiency: completedWithFullDetails.filter(a => a.performance.efficiency).length > 0 ?
          Math.round(completedWithFullDetails.filter(a => a.performance.efficiency).reduce((sum, a) => sum + a.performance.efficiency, 0) / 
            completedWithFullDetails.filter(a => a.performance.efficiency).length) : null,
        performanceDistribution: {
          excellent: completedWithFullDetails.filter(a => a.performance.rating === 'Excellent').length,
          good: completedWithFullDetails.filter(a => a.performance.rating === 'Good').length,
          average: completedWithFullDetails.filter(a => a.performance.rating === 'Average').length,
          poor: completedWithFullDetails.filter(a => a.performance.rating === 'Poor').length
        }
      },
      dateRange: {
        from: fromDate || 'All time',
        to: toDate || 'Present',
        oldestCompletion: completedWithFullDetails.length > 0 ? 
          completedWithFullDetails[completedWithFullDetails.length - 1]?.timeline?.completed : null,
        newestCompletion: completedWithFullDetails.length > 0 ? 
          completedWithFullDetails[0]?.timeline?.completed : null
      }
    };

    // Calculate average completion time in hours
    if (completionStats.performance.averageCompletionTime.minutes > 0) {
      completionStats.performance.averageCompletionTime.hours = 
        Math.round(completionStats.performance.averageCompletionTime.minutes / 60 * 100) / 100;
    }

    res.status(200).json({
      success: true,
      message: 'User completed assignments with full checkpoint details retrieved successfully',
      data: {
        user: {
          id: user.id,
          username: user.username || `User_${user.id}`,
          ...(user.email && { email: user.email }),
          ...(user.name && { name: user.name })
        },
        completedAssignments: completedWithFullDetails,
        stats: completionStats,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        },
        filters: {
          fromDate: fromDate || null,
          toDate: toDate || null,
          sortBy,
          sortOrder
        },
        metadata: {
          generatedAt: new Date().toISOString(),
          dataIncludes: [
            'full_checkpoint_details',
            'completion_metrics',
            'performance_analysis',
            'timeline_information'
          ]
        }
      }
    });
  } catch (error) {
    console.error('Get user completed assignments error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user completed assignments',
      error: error.message,
    });
  }
};

// Update Assignment
exports.updateAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findByPk(id);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (updateData.routeId || updateData.userId) {
      const newRouteId = updateData.routeId || assignment.routeId;
      const newUserId = updateData.userId || assignment.userId;

      if (newRouteId !== assignment.routeId) {
        const existingAssignment = await RouteAssignment.findOne({
          where: {
            routeId: newRouteId,
            isActive: true,
            status: { [Op.in]: ['assigned', 'in_progress'] },
            id: { [Op.ne]: id }
          }
        });

        if (existingAssignment) {
          return res.status(409).json({
            success: false,
            message: 'Route is already assigned to another user',
            error: 'ROUTE_ALREADY_ASSIGNED'
          });
        }
      }
    }

    const allowedFields = ['startDate', 'endDate', 'notes', 'status'];
    const filteredData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {});

    await assignment.update(filteredData);

    res.status(200).json({
      success: true,
      message: 'Assignment updated successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Update assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update assignment',
      error: error.message,
    });
  }
};

// Start Route
exports.startRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findOne({
      where: { 
        id,
        isActive: true,
        status: 'assigned'
      }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found or not in assigned status',
      });
    }

    await assignment.update({
      status: 'in_progress',
      startDate: new Date(),
      notes: notes || `Route started at ${new Date().toLocaleString()}`,
    });

    res.status(200).json({
      success: true,
      message: 'Route started successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Start route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start route',
      error: error.message,
    });
  }
};

// Complete Route
exports.completeRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, forceComplete = false } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findOne({
      where: { 
        id,
        isActive: true 
      }
    });

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (assignment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Assignment is already completed',
      });
    }

    const route = await Route.findByPk(assignment.routeId);
    const totalCheckpoints = route?.checkpoints?.length || 0;
    const completedCheckpoints = assignment.completedCheckpoints?.length || 0;

    if (completedCheckpoints < totalCheckpoints && !forceComplete) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete route. ${totalCheckpoints - completedCheckpoints} checkpoints remaining.`,
        error: 'INCOMPLETE_CHECKPOINTS',
        data: {
          totalCheckpoints,
          completedCheckpoints,
          remainingCheckpoints: totalCheckpoints - completedCheckpoints,
          canForceComplete: true,
          suggestion: 'Complete all checkpoints or use forceComplete=true to override'
        }
      });
    }

    await assignment.update({
      status: 'completed',
      endDate: new Date(),
      notes: notes || `Route completed at ${new Date().toLocaleString()}${forceComplete ? ' (Force completed)' : ''}`,
    });

    res.status(200).json({
      success: true,
      message: `Route completed successfully${forceComplete ? ' (force completed)' : ''}`,
      data: assignment,
    });
  } catch (error) {
    console.error('Complete route error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete route',
      error: error.message,
    });
  }
};

// Cancel Assignment
exports.cancelAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, reason } = req.body;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findByPk(id);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (!['assigned', 'in_progress'].includes(assignment.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel assignment with status: ${assignment.status}`,
      });
    }

    const cancellationReason = reason || 'No reason provided';
    const cancellationNotes = notes || `Assignment cancelled at ${new Date().toLocaleString()}. Reason: ${cancellationReason}`;

    await assignment.update({
      status: 'cancelled',
      endDate: new Date(),
      notes: cancellationNotes,
    });

    res.status(200).json({
      success: true,
      message: 'Assignment cancelled successfully',
      data: assignment,
    });
  } catch (error) {
    console.error('Cancel assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel assignment',
      error: error.message,
    });
  }
};

// Delete Assignment
exports.deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid assignment ID',
      });
    }

    const assignment = await RouteAssignment.findByPk(id);
    if (!assignment || !assignment.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Assignment not found',
      });
    }

    if (assignment.status === 'in_progress') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete assignment that is in progress. Cancel it first.',
      });
    }

    await assignment.update({ isActive: false });

    res.status(200).json({
      success: true,
      message: 'Assignment deleted successfully',
    });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete assignment',
      error: error.message,
    });
  }
};

// Check Route Availability
exports.checkRouteAvailability = async (req, res) => {
  try {
    const { routeId } = req.params;

    if (!routeId || isNaN(routeId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid route ID',
      });
    }

    const route = await Route.findByPk(routeId);
    if (!route) {
      return res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    }

    const currentAssignment = await RouteAssignment.findOne({
      where: {
        routeId: routeId,
        isActive: true,
        status: { [Op.in]: ['assigned', 'in_progress'] }
      }
    });

    let assignedToUser = null;
    if (currentAssignment) {
      const user = await User.findByPk(currentAssignment.userId);
      assignedToUser = {
        id: user.id,
        username: user.username || `User_${user.id}`,
        assignmentId: currentAssignment.id,
        status: currentAssignment.status,
        assignedAt: currentAssignment.createdAt
      };
    }

    res.status(200).json({
      success: true,
      data: {
        route: {
          id: route.id,
          name: route.name,
          isActive: route.isActive
        },
        isAvailable: !currentAssignment && route.isActive,
        currentAssignment: assignedToUser,
        canAssign: !currentAssignment && route.isActive
      }
    });
  } catch (error) {
    console.error('Check route availability error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check route availability',
      error: error.message,
    });
  }
};






// Enhanced getCheckpointsByPoliceStation function with complete User details
exports.getCheckpointsByPoliceStation = async (req, res) => {
  try {
    const { policeStationId } = req.params;
    const { page = 1, limit = 10, search, includeRouteData = 'true' } = req.query;

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

    // If basic data is requested, return simple response
    if (includeRouteData !== 'true') {
      return res.status(200).json({
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
    }

    // Enhanced version with route data and user details
    const checkpointsWithRouteData = await Promise.all(
      checkpointsWithCoords.map(async (checkpoint) => {
        try {
          // Get checkpoint scans for this checkpoint with User details
          const scans = await CheckpointScan.findAll({
            where: {
              checkpointId: checkpoint.id
            },
            include: [
              {
                model: RouteAssignment,
                required: false,
                include: [
                  {
                    model: Route,
                    required: false,
                    attributes: ['id', 'name', 'description']
                  },
                  {
                    model: User,
                    required: false,
                    attributes: [
                      'id', 'username', 'smartusername', 'smartuseremail', 
                      'smartuserphone', 'smartuserrank', 'userId', 'roleId', 
                      'roleName', 'stations'
                    ]
                  }
                ]
              },
              {
                model: User, // Direct user association for scan
                required: false,
                attributes: [
                  'id', 'username', 'smartusername', 'smartuseremail', 
                  'smartuserphone', 'smartuserrank', 'userId', 'roleId', 
                  'roleName', 'stations'
                ]
              }
            ],
            order: [['scanTime', 'DESC']],
            limit: 50 // Limit to recent 50 scans per checkpoint
          });

          // Get route assignments that have scanned this checkpoint with User details
          const routeIds = [...new Set(scans.map(scan => scan.routeId).filter(id => id))];
          
          let assignments = [];
          if (routeIds.length > 0) {
            assignments = await RouteAssignment.findAll({
              where: {
                routeId: {
                  [Op.in]: routeIds
                },
                isActive: true
              },
              include: [
                {
                  model: Route,
                  attributes: ['id', 'name', 'description', 'checkpoints']
                },
                {
                  model: User,
                  required: false,
                  attributes: [
                    'id', 'username', 'smartusername', 'smartuseremail', 
                    'smartuserphone', 'smartuserrank', 'userId', 'roleId', 
                    'roleName', 'stations'
                  ]
                }
              ]
            });
          }

          // Group data by routeId
          const routeDataMap = {};
          let totalImages = 0;
          let totalVideos = 0;
          let totalAudios = 0;
          let scansWithNotes = 0;
          let validScans = 0;
          const uniqueUsers = new Set();

          // Process scans first
          scans.forEach(scan => {
            const routeId = scan.routeId;
            if (!routeDataMap[routeId]) {
              routeDataMap[routeId] = {
                route: {
                  id: routeId,
                  name: scan.RouteAssignment?.Route?.name || 'Unknown Route',
                  description: scan.RouteAssignment?.Route?.description || ''
                },
                assignments: [],
                scans: [],
                statistics: {
                  totalScans: 0,
                  uniqueUsers: new Set(),
                  recentScans: 0,
                  validScans: 0,
                  invalidScans: 0,
                  totalImages: 0,
                  totalVideos: 0,
                  totalAudios: 0,
                  scansWithNotes: 0,
                  scansWithMedia: 0,
                  averageDistance: 0,
                  distanceSum: 0
                }
              };
            }

            // Get user info from scan's direct user association or route assignment's user
            const scanUser = scan.User || scan.RouteAssignment?.User;
            
            routeDataMap[routeId].scans.push({
              // All CheckpointScan fields
              id: scan.id,
              userId: scan.userId,
              checkpointId: scan.checkpointId,
              routeId: scan.routeId,
              routeAssignmentId: scan.routeAssignmentId,
              scanTime: scan.scanTime,
              userLatLong: scan.userLatLong,
              distance: scan.distance,
              notes: scan.notes,
              images: scan.images || [],
              videos: scan.videos || [],
              audios: scan.audios || [],
              metadata: scan.metadata || {},
              isValid: scan.isValid,
              // Additional computed fields
              assignmentStatus: scan.RouteAssignment?.status || 'unknown',
              routeName: scan.RouteAssignment?.Route?.name || 'Unknown Route',
              // Complete user details
              user: scanUser ? {
                id: scanUser.id,
                userId: scanUser.userId,
                username: scanUser.username,
                smartusername: scanUser.smartusername,
                smartuseremail: scanUser.smartuseremail,
                smartuserphone: scanUser.smartuserphone,
                smartuserrank: scanUser.smartuserrank,
                roleId: scanUser.roleId,
                roleName: scanUser.roleName,
                stations: scanUser.stations,
                displayName: scanUser.smartusername || scanUser.username,
                displayRank: scanUser.smartuserrank || 'Officer'
              } : null,
              // Media count summary
              mediaCount: {
                images: (scan.images || []).length,
                videos: (scan.videos || []).length,
                audios: (scan.audios || []).length,
                total: (scan.images || []).length + (scan.videos || []).length + (scan.audios || []).length
              }
            });

            // Update statistics
            routeDataMap[routeId].statistics.totalScans++;
            routeDataMap[routeId].statistics.uniqueUsers.add(scan.userId);
            uniqueUsers.add(scan.userId);

            // Count media files
            const imageCount = (scan.images || []).length;
            const videoCount = (scan.videos || []).length;
            const audioCount = (scan.audios || []).length;
            
            routeDataMap[routeId].statistics.totalImages += imageCount;
            routeDataMap[routeId].statistics.totalVideos += videoCount;
            routeDataMap[routeId].statistics.totalAudios += audioCount;
            
            // Count scans with notes
            if (scan.notes && scan.notes.trim()) {
              routeDataMap[routeId].statistics.scansWithNotes++;
              scansWithNotes++;
            }
            
            // Count scans with media
            if (imageCount > 0 || videoCount > 0 || audioCount > 0) {
              routeDataMap[routeId].statistics.scansWithMedia++;
            }
            
            // Count valid/invalid scans
            if (scan.isValid) {
              routeDataMap[routeId].statistics.validScans++;
              validScans++;
            } else {
              routeDataMap[routeId].statistics.invalidScans++;
            }
            
            // Sum distance for average calculation
            if (scan.distance) {
              routeDataMap[routeId].statistics.distanceSum += scan.distance;
            }
            
            // Update totals for checkpoint summary
            totalImages += imageCount;
            totalVideos += videoCount;
            totalAudios += audioCount;

            // Count recent scans (last 7 days)
            const scanDate = new Date(scan.scanTime);
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            if (scanDate >= sevenDaysAgo) {
              routeDataMap[routeId].statistics.recentScans++;
            }
          });

          // Process assignments with user details
          assignments.forEach(assignment => {
            const routeId = assignment.routeId;
            if (routeDataMap[routeId]) {
              routeDataMap[routeId].assignments.push({
                id: assignment.id,
                userId: assignment.userId,
                status: assignment.status,
                startDate: assignment.startDate,
                endDate: assignment.endDate,
                completedCheckpoints: assignment.completedCheckpoints || [],
                // Complete user details
                user: assignment.User ? {
                  id: assignment.User.id,
                  userId: assignment.User.userId,
                  username: assignment.User.username,
                  smartusername: assignment.User.smartusername,
                  smartuseremail: assignment.User.smartuseremail,
                  smartuserphone: assignment.User.smartuserphone,
                  smartuserrank: assignment.User.smartuserrank,
                  roleId: assignment.User.roleId,
                  roleName: assignment.User.roleName,
                  stations: assignment.User.stations,
                  displayName: assignment.User.smartusername || assignment.User.username,
                  displayRank: assignment.User.smartuserrank || 'Officer'
                } : null
              });

              // Update route info if available
              if (assignment.Route) {
                routeDataMap[routeId].route = {
                  id: assignment.Route.id,
                  name: assignment.Route.name,
                  description: assignment.Route.description,
                  checkpoints: assignment.Route.checkpoints || []
                };
              }
            }
          });

          // Convert sets to counts and calculate averages
          Object.keys(routeDataMap).forEach(routeId => {
            const routeStats = routeDataMap[routeId].statistics;
            routeStats.uniqueUsers = routeStats.uniqueUsers.size;
            
            // Calculate average distance
            if (routeStats.totalScans > 0 && routeStats.distanceSum > 0) {
              routeStats.averageDistance = Math.round(routeStats.distanceSum / routeStats.totalScans);
            }
            
            // Calculate percentages
            routeStats.validScanPercentage = routeStats.totalScans > 0 ? 
              ((routeStats.validScans / routeStats.totalScans) * 100).toFixed(1) : 0;
            routeStats.scansWithNotesPercentage = routeStats.totalScans > 0 ? 
              ((routeStats.scansWithNotes / routeStats.totalScans) * 100).toFixed(1) : 0;
            routeStats.scansWithMediaPercentage = routeStats.totalScans > 0 ? 
              ((routeStats.scansWithMedia / routeStats.totalScans) * 100).toFixed(1) : 0;
            
            // Remove distanceSum as it's no longer needed
            delete routeStats.distanceSum;
          });

          return {
            ...checkpoint,
            routeData: Object.values(routeDataMap),
            summary: {
              totalRoutes: Object.keys(routeDataMap).length,
              totalScans: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.totalScans, 0),
              validScans: validScans,
              totalUniqueUsers: uniqueUsers.size,
              recentActivity: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.recentScans, 0),
              mediaStatistics: {
                totalImages: totalImages,
                totalVideos: totalVideos,
                totalAudios: totalAudios,
                totalMediaFiles: totalImages + totalVideos + totalAudios,
                scansWithMedia: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.scansWithMedia, 0)
              },
              notesStatistics: {
                scansWithNotes: scansWithNotes,
                notesPercentage: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.totalScans, 0) > 0 ?
                  ((scansWithNotes / Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.totalScans, 0)) * 100).toFixed(1) : 0
              },
              validationStatistics: {
                validScans: validScans,
                invalidScans: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.invalidScans, 0),
                validScanPercentage: Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.totalScans, 0) > 0 ?
                  ((validScans / Object.values(routeDataMap).reduce((sum, route) => sum + route.statistics.totalScans, 0)) * 100).toFixed(1) : 0
              },
              averageDistance: Object.values(routeDataMap).length > 0 ?
                Math.round(Object.values(routeDataMap).reduce((sum, route) => sum + (route.statistics.averageDistance || 0), 0) / Object.values(routeDataMap).length) : 0
            }
          };
        } catch (error) {
          console.error(`Error processing checkpoint ${checkpoint.id}:`, error);
          return {
            ...checkpoint,
            routeData: [],
            summary: { totalRoutes: 0, totalScans: 0, totalUniqueUsers: 0, recentActivity: 0 },
            error: error.message
          };
        }
      })
    );

    // Calculate overall statistics
    const overallStats = {
      totalCheckpoints: count,
      totalScans: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.totalScans || 0), 0),
      totalValidScans: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.validScans || 0), 0),
      totalUniqueUsers: new Set(checkpointsWithRouteData.flatMap(cp => 
        cp.routeData?.flatMap(route => route.scans.map(s => s.userId)) || []
      )).size,
      checkpointsWithActivity: checkpointsWithRouteData.filter(cp => (cp.summary?.totalScans || 0) > 0).length,
      recentActivity: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.recentActivity || 0), 0),
      mediaStatistics: {
        totalImages: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.mediaStatistics?.totalImages || 0), 0),
        totalVideos: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.mediaStatistics?.totalVideos || 0), 0),
        totalAudios: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.mediaStatistics?.totalAudios || 0), 0),
        totalMediaFiles: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.mediaStatistics?.totalMediaFiles || 0), 0),
        scansWithMedia: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.mediaStatistics?.scansWithMedia || 0), 0)
      },
      notesStatistics: {
        scansWithNotes: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.notesStatistics?.scansWithNotes || 0), 0),
        notesPercentage: (() => {
          const totalScans = checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.totalScans || 0), 0);
          const scansWithNotes = checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.notesStatistics?.scansWithNotes || 0), 0);
          return totalScans > 0 ? ((scansWithNotes / totalScans) * 100).toFixed(1) : 0;
        })()
      },
      validationStatistics: {
        validScans: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.validScans || 0), 0),
        invalidScans: checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.validationStatistics?.invalidScans || 0), 0),
        validScanPercentage: (() => {
          const totalScans = checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.totalScans || 0), 0);
          const validScans = checkpointsWithRouteData.reduce((sum, cp) => sum + (cp.summary?.validScans || 0), 0);
          return totalScans > 0 ? ((validScans / totalScans) * 100).toFixed(1) : 0;
        })()
      },
      averageDistance: (() => {
        const checkpointsWithScans = checkpointsWithRouteData.filter(cp => (cp.summary?.totalScans || 0) > 0);
        if (checkpointsWithScans.length === 0) return 0;
        const totalAvgDistance = checkpointsWithScans.reduce((sum, cp) => sum + (cp.summary?.averageDistance || 0), 0);
        return Math.round(totalAvgDistance / checkpointsWithScans.length);
      })()
    };

    res.status(200).json({
      success: true,
      message: `Found ${count} checkpoints for police station ${policeStationId} with route data and user details`,
      data: {
        policeStationId: parseInt(policeStationId),
        checkpoints: checkpointsWithRouteData,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit))
        },
        statistics: overallStats
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