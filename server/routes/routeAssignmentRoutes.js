// routes/routeAssignmentRoutes.js
const express = require('express');
const router = express.Router();
const routeAssignmentController = require('../controllers/routeAssignmentController');

// Assign Route to User
router.post('/assign', routeAssignmentController.assignRoute);

// Get All Assignments (Admin view)
router.get('/', routeAssignmentController.getAllAssignments);

// Get Assignment by ID
router.get('/:id', routeAssignmentController.getAssignmentById);

// Update Assignment
router.put('/:id', routeAssignmentController.updateAssignment);

// Delete Assignment
router.delete('/:id', routeAssignmentController.deleteAssignment);


// ========== SEGREGATED USER ROUTE ENDPOINTS ==========

// Get ALL user assignments (any status)
router.get('/user/:userId/all', routeAssignmentController.getAllUserAssignments);

// Get user's COMPLETED assignments only
router.get('/user/:userId/completed', routeAssignmentController.getUserCompletedAssignments);

// Original user assignments endpoint (for backward compatibility)
router.get('/user/:userId', routeAssignmentController.getUserAssignments);

// ========== POLICE STATION ENDPOINTS ==========

// Get assignments by Police Station ID - NEW ENDPOINT
router.get('/police-station/:policeStationId', routeAssignmentController.getAssignmentsByPoliceStation);

// ========== OTHER ENDPOINTS ==========

// Check Route Availability
router.get('/route/:routeId/availability', routeAssignmentController.checkRouteAvailability);

// Start Route
router.put('/:id/start', routeAssignmentController.startRoute);

// Complete Route
router.put('/:id/complete', routeAssignmentController.completeRoute);

// Cancel Assignment
router.put('/:id/cancel', routeAssignmentController.cancelAssignment);

router.get('/police-station/:policeStationId/checkpoints', routeAssignmentController.getCheckpointsByPoliceStation);

module.exports = router;