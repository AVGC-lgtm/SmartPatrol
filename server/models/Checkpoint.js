// models/Checkpoint.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Checkpoint = sequelize.define('Checkpoint', {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  lat_long: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Combined latitude,longitude format (e.g., 19.11027353817422,74.54616581349332)'
  },
  address: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  scanRadius: {
    type: DataTypes.INTEGER,
    defaultValue: 100,
  },
  qrCode: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  qrCodeUrl: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  policeStationId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'ID of the police station this checkpoint belongs to'
  },
}, {
  // Add instance methods to extract latitude and longitude
  instanceMethods: {
    getLatitude: function() {
      return parseFloat(this.lat_long.split(',')[0]);
    },
    getLongitude: function() {
      return parseFloat(this.lat_long.split(',')[1]);
    }
  }
});

// Add instance methods for extracting lat/lng
Checkpoint.prototype.getLatitude = function() {
  return parseFloat(this.lat_long.split(',')[0]);
};

Checkpoint.prototype.getLongitude = function() {
  return parseFloat(this.lat_long.split(',')[1]);
};

module.exports = Checkpoint;