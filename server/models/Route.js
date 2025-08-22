// models/Route.js

const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Route = sequelize.define('Route', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  checkpoints: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: [],
  },
    policeStationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'ID of the police station this route belongs to'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
});

module.exports = Route;