require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/db');
const { validateEnv } = require('./config/env');
const { startRoiScheduler } = require('./services/cronService');
const port = Number(process.env.PORT || 5000);

(async () => {
  try {
    validateEnv();
    await connectDB();
    const server = app.listen(port, () => console.log(`API listening at http://localhost:${port}`));
    const task = process.env.NODE_ENV !== 'test' ? startRoiScheduler() : null;

    const shutdown = async (signal) => {
      console.log(`${signal} received, shutting down`);
      task?.stop();
      server.close(async () => { await mongoose.disconnect(); process.exit(0); });
      setTimeout(() => process.exit(1), 10000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));
  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
})();
