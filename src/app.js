const express = require('express');
const cors = require('cors');
const corsOptions = require('./config/cors');
const healthRouter = require('./routes/health.routes');
const authRouter = require('./modules/auth/auth.routes');
const usersRouter = require('./modules/users/users.routes');
const requestId = require('./middleware/request-id.middleware');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();

app.disable('x-powered-by');

app.use(requestId);
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/users', usersRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
