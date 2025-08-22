const express = require('express');
const cors = require('cors'); // Import cors
const sequelize = require('./config/database'); // Import the Sequelize instance....
const { setupAssociations } = require('./models/associations'); // Import associations
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Enable CORS
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Note: All files are now stored directly in AWS S3

// Routes
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/checkpoints', require('./routes/checkpointRoutes'));
app.use('/api/routes', require('./routes/routeRoutes'));
app.use('/api/route-assignments', require('./routes/routeAssignmentRoutes'));

// Setup model associations
setupAssociations();

// Sync sequelize models with the database
sequelize.sync({ force: false }) // Set to 'true' only for testing, to drop tables on restart
  .then(() => console.log('Database synced successfully'))
  .catch((error) => console.error('Error syncing the database:', error));

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});