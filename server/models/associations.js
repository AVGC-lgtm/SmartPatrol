// models/associations.js

const User = require('./User');
const Checkpoint = require('./Checkpoint');
const Route = require('./Route');
const RouteAssignment = require('./RouteAssignment');
const CheckpointScan = require('./CheckpointScan');

const setupAssociations = () => {
  // User and RouteAssignment associations
  User.hasMany(RouteAssignment, { foreignKey: 'userId' });
  RouteAssignment.belongsTo(User, { foreignKey: 'userId' });

  // Route and RouteAssignment associations
  Route.hasMany(RouteAssignment, { foreignKey: 'routeId' });
  RouteAssignment.belongsTo(Route, { foreignKey: 'routeId' });

  // CheckpointScan associations
  User.hasMany(CheckpointScan, { foreignKey: 'userId' });
  CheckpointScan.belongsTo(User, { foreignKey: 'userId' });

  Checkpoint.hasMany(CheckpointScan, { foreignKey: 'checkpointId' });
  CheckpointScan.belongsTo(Checkpoint, { foreignKey: 'checkpointId' });

  RouteAssignment.hasMany(CheckpointScan, { foreignKey: 'routeAssignmentId' });
  CheckpointScan.belongsTo(RouteAssignment, { foreignKey: 'routeAssignmentId' });
};

module.exports = { 
  setupAssociations,
  User,
  Checkpoint,
  Route,
  RouteAssignment,
  CheckpointScan
};