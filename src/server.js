require('dotenv').config();

const app = require('./app');

const port = Number(process.env.PORT || 8080);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`evaluacion-api listening on port ${port}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received; shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
