const pool = require('../../config/db');

const PUBLIC_FIELDS = `
  id_usuario,
  nombre,
  email,
  rol,
  activo,
  last_login_at,
  created_at,
  updated_at,
  CASE WHEN password_hash IS NULL THEN 1 ELSE 0 END AS activation_pending
`;

async function listUsers(search = '') {
  const term = search.trim();
  const like = `%${term}%`;

  const [rows] = await pool.execute(
    `SELECT ${PUBLIC_FIELDS}
     FROM usuarios
     WHERE deleted_at IS NULL
       AND (? = '' OR nombre LIKE ? OR email LIKE ?)
     ORDER BY created_at DESC, id_usuario DESC`,
    [term, like, like]
  );

  return rows;
}

async function findUserById(idUsuario) {
  const [rows] = await pool.execute(
    `SELECT ${PUBLIC_FIELDS}
     FROM usuarios
     WHERE id_usuario = ? AND deleted_at IS NULL
     LIMIT 1`,
    [idUsuario]
  );
  return rows[0] || null;
}

async function lockUserById(connection, idUsuario) {
  const [rows] = await connection.execute(
    `SELECT
       id_usuario, nombre, email, password_hash, rol, activo, deleted_at
     FROM usuarios
     WHERE id_usuario = ?
     LIMIT 1
     FOR UPDATE`,
    [idUsuario]
  );
  return rows[0] || null;
}

async function lockActiveSuperadmins(connection) {
  const [rows] = await connection.execute(
    `SELECT id_usuario
     FROM usuarios
     WHERE rol = 'superadmin'
       AND activo = 1
       AND deleted_at IS NULL
     FOR UPDATE`
  );
  return rows;
}

async function createUser(connection, { nombre, email, rol }) {
  const [result] = await connection.execute(
    `INSERT INTO usuarios
      (nombre, email, password_hash, rol, activo, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [nombre, email, rol]
  );
  return result.insertId;
}

async function updateUser(connection, idUsuario, changes) {
  const fields = [];
  const values = [];

  for (const [field, value] of Object.entries(changes)) {
    fields.push(`${field} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return;

  values.push(idUsuario);

  await connection.execute(
    `UPDATE usuarios
     SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP()
     WHERE id_usuario = ?`,
    values
  );
}

async function softDeleteUser(connection, idUsuario, deletedBy) {
  await connection.execute(
    `UPDATE usuarios
     SET activo = 0,
         deleted_at = UTC_TIMESTAMP(),
         deleted_by = ?,
         updated_at = UTC_TIMESTAMP()
     WHERE id_usuario = ?`,
    [deletedBy, idUsuario]
  );
}

module.exports = {
  listUsers,
  findUserById,
  lockUserById,
  lockActiveSuperadmins,
  createUser,
  updateUser,
  softDeleteUser
};
