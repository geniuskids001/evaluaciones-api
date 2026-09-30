const crypto = require('crypto');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function createRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function issueToken(connection, { idUsuario, tipo, ttlMinutes }) {
  const rawToken = createRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  await connection.execute(
    `UPDATE tokens_usuario
     SET used_at = UTC_TIMESTAMP()
     WHERE id_usuario = ? AND tipo = ? AND used_at IS NULL`,
    [idUsuario, tipo]
  );

  await connection.execute(
    `INSERT INTO tokens_usuario
      (id_usuario, tipo, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
    [idUsuario, tipo, tokenHash, expiresAt]
  );

  return rawToken;
}

async function lockValidToken(connection, rawToken, tipo) {
  const tokenHash = hashToken(rawToken);

  const [rows] = await connection.execute(
    `SELECT
       t.id_token_usuario,
       t.id_usuario,
       t.tipo,
       t.expires_at,
       u.nombre,
       u.email,
       u.password_hash,
       u.rol,
       u.activo,
       u.deleted_at
     FROM tokens_usuario t
     INNER JOIN usuarios u ON u.id_usuario = t.id_usuario
     WHERE t.token_hash = ?
       AND t.tipo = ?
       AND t.used_at IS NULL
       AND t.expires_at > UTC_TIMESTAMP()
     LIMIT 1
     FOR UPDATE`,
    [tokenHash, tipo]
  );

  return rows[0] || null;
}

async function invalidateAllUserTokens(connection, idUsuario) {
  await connection.execute(
    `UPDATE tokens_usuario
     SET used_at = UTC_TIMESTAMP()
     WHERE id_usuario = ? AND used_at IS NULL`,
    [idUsuario]
  );
}

module.exports = {
  issueToken,
  lockValidToken,
  invalidateAllUserTokens
};
