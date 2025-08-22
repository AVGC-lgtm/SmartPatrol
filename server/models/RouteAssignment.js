// models/RouteAssignment.js

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const RouteAssignment = sequelize.define('RouteAssignment', {
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  routeId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  policeStationId: {
    type: DataTypes.INTEGER,
    allowNull: true, // Make it optional initially for backward compatibility
  },
  startDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  endDate: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('assigned', 'in_progress', 'completed', 'cancelled'),
    defaultValue: 'assigned',
  },
  completedCheckpoints: {
    type: DataTypes.JSON,
    defaultValue: [],
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = RouteAssignment;