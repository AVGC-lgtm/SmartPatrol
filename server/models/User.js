// models/user.js

const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcrypt');
const sequelize = require('../config/database'); // Import the sequelize instance

const User = sequelize.define('User', {
  smartuseremail: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  smartusername: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  smartuserphone: {
    type: DataTypes.STRING,
    allowNull: true,
    unique: true,
  },
  smartuserrank: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  roleId: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  roleName: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  stations: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  username: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false,
  },
}, {
  hooks: {
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    },
    beforeUpdate: async (user) => {
      if (user.changed('password')) {
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

module.exports = User;
