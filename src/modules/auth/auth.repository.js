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

async function findUserByEmail(email) {
  const [rows] = await pool.execute(
    'SELECT id_usuario FROM usuarios WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function findUserByEmailForConnection(connection, email) {
  const [rows] = await connection.execute(
    'SELECT id_usuario FROM usuarios WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function findActiveUserById(idUsuario) {
  const [rows] = await pool.execute(
    `SELECT id_usuario, nombre, email, password_hash, rol, activo, last_login_at, created_at
     FROM usuarios
     WHERE id_usuario = ? AND deleted_at IS NULL
     LIMIT 1`,
    [idUsuario]
  );
  return rows[0] || null;
}

async function updateName(idUsuario, nombre) {
  await pool.execute(
    'UPDATE usuarios SET nombre = ?, updated_at = UTC_TIMESTAMP() WHERE id_usuario = ?',
    [nombre, idUsuario]
  );
}

async function updateLastLogin(idUsuario) {
  await pool.execute(
    'UPDATE usuarios SET last_login_at = UTC_TIMESTAMP() WHERE id_usuario = ?',
    [idUsuario]
  );
}

async function updateEmail(connection, idUsuario, email) {
  await connection.execute(
    'UPDATE usuarios SET email = ?, updated_at = UTC_TIMESTAMP() WHERE id_usuario = ?',
    [email, idUsuario]
  );
}

async function updatePassword(connection, idUsuario, passwordHash) {
  await connection.execute(
    `UPDATE usuarios
     SET password_hash = ?, updated_at = UTC_TIMESTAMP()
     WHERE id_usuario = ?`,
    [passwordHash, idUsuario]
  );
}

module.exports = {
  findActiveUserByEmail,
  findUserByEmail,
  findUserByEmailForConnection,
  findActiveUserById,
  updateName,
  updateEmail,
  updateLastLogin,
  updatePassword
};
