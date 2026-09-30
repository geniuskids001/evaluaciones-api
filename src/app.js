const express = require('express');
const healthRouter = require('./routes/health.routes');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.use('/health', healthRouter);

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'not_found'
  });
});

module.exports = app;
