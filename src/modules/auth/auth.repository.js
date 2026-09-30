const pool = require('../../config/db');

async function findActiveUserByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT id_usuario, nombre, email, password_hash, rol, activo
     FROM usuarios
     WHERE email = ? AND deleted_at IS NULL
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function updateLastLogin(idUsuario) {
  await pool.execute(
    'UPDATE usuarios SET last_login_at = UTC_TIMESTAMP() WHERE id_usuario = ?',
    [idUsuario]
  );
}

module.exports = { findActiveUserByEmail, updateLastLogin };
