// controllers/authController.js

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT secret key - should be in .env file in production
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

// Login controller
exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find user by username
    const user = await User.findOne({ where: { username } });
    
    if (!user) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    // Use stored stations data from database
    const stations = user.stations || [];

    // Use stored roleName instead of mapping
    const roleName = user.roleName || 'user';

    // Generate JWT token with 1 day expiration - using same field names as registration
    const token = jwt.sign(
      { 
        id: user.id, // Added this for token verification
        smartuseremail: user.smartuseremail,
        smartusername: user.smartusername,
        smartuserphone: user.smartuserphone,
        smartuserrank: user.smartuserrank,
        userId: user.userId,
        roleId: user.roleId,
        roleName: roleName,
        stations: stations
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    // Return message and token only
    res.status(200).json({
      message: 'Login successful',
      token
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Error during login', error: err.message });
  }
};

// Verify token (optional endpoint to check if token is valid)
exports.verifyToken = async (req, res) => {
  try {
    // Token is already verified by auth middleware if we reach here
    const user = await User.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({
      message: 'Token is valid',
      user
    });
  } catch (err) {
    res.status(500).json({ message: 'Error verifying token', error: err.message });
  }
};