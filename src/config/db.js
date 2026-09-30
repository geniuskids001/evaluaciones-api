const mysql = require('mysql2/promise');

const useSocket = Boolean(process.env.DB_SOCKET_PATH);

const pool = mysql.createPool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ...(useSocket
    ? { socketPath: process.env.DB_SOCKET_PATH }
    : {
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT || 3306)
      }),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  dateStrings: true
});

module.exports = pool;
