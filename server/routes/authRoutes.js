// routes/authRoutes.js

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { body } = require('express-validator');

// Validation middleware for login
const validateLogin = [
  body('username')
    .notEmpty().withMessage('Username is required')
    .trim(),
  
  body('password')
    .notEmpty().withMessage('Password is required'),
  
  // Handle validation errors
  (req, res, next) => {
    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }
    next();
  }
];

// Login route
router.post('/login', validateLogin, authController.login);

// Verify token route (protected)
router.get('/verify', authMiddleware, authController.verifyToken);

module.exports = router;