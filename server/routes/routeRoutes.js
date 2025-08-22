// routes/routeRoutes.js

const express = require('express');
const router = express.Router();
const routeController = require('../controllers/routeController');

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

// Create Route (policeStationId required)
router.post('/', validatePoliceStationId, routeController.createRoute);

// Get All Routes (with pagination, search, priority, and police station filter)
router.get('/', routeController.getAllRoutes);

// Get Routes by Police Station ID
router.get('/police-station/:policeStationId', routeController.getRoutesByPoliceStation);

// Validate Route Checkpoints
router.post('/validate-checkpoints', routeController.validateRouteCheckpoints);

// Get Route by ID
router.get('/:id', routeController.getRouteById);

// Update Route (policeStationId optional for updates)
router.put('/:id', validatePoliceStationId, routeController.updateRoute);

// Delete Route
router.delete('/:id', routeController.deleteRoute);

module.exports = router;