// config/database.js

const { Sequelize } = require('sequelize');
require('dotenv').config();

// Setup Sequelize connection using the DATABASE_URL stored in the .env file
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres', // Using PostgreSQL
  dialectOptions: {
    ssl: {
      require: true, // SSL is required for connection
      rejectUnauthorized: false, // This option is needed if you're using self-signed certificates
    }
  },
  logging: false // Disable logging for production
});

// Test the database connection
sequelize.authenticate()
  .then(() => console.log('Database connected successfully'))
  .catch((error) => console.error('Unable to connect to the database:', error));

module.exports = sequelize;
