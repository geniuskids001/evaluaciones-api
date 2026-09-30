const parseAllowedOrigins = () =>
  (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsOptions = (req, callback) => {
  const configuredOrigins = parseAllowedOrigins();
  const openCors = configuredOrigins.length === 0 || configuredOrigins.includes('*');
  const origin = req.header('Origin');

  if (openCors || !origin || configuredOrigins.includes(origin)) {
    return callback(null, {
      origin: openCors ? '*' : origin,
      credentials: false,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    });
  }

  return callback(null, { origin: false });
};

module.exports = corsOptions;
