// models/CheckpointScan.js
const { Sequelize, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CheckpointScan = sequelize.define('CheckpointScan', {
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  checkpointId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  routeId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  routeAssignmentId: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  scanTime: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
  },
  userLatLong: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User location at scan time (latitude,longitude)',
  },
  distance: {
    type: DataTypes.FLOAT,
    allowNull: true,
    comment: 'Distance in meters from checkpoint',
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'User notes about the checkpoint scan',
  },
  images: {
    type: DataTypes.JSON,
    defaultValue: [],
    comment: 'Array of image URLs stored in S3',
  },
  videos: {
    type: DataTypes.JSON,
    defaultValue: [],
    comment: 'Array of video URLs stored in S3',
  },
  audios: {
    type: DataTypes.JSON,
    defaultValue: [],
    comment: 'Array of audio URLs stored in S3',
  },
  metadata: {
    type: DataTypes.JSON,
    defaultValue: {},
    comment: 'Additional metadata (device info, app version, etc)',
  },
  isValid: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether the scan was valid (within radius)',
  },
});

module.exports = CheckpointScan;