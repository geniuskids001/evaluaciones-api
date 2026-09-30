const crypto = require('crypto');

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function createRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function createSignedPayloadToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function readSignedPayloadToken(rawToken) {
  const [body, signature] = String(rawToken || '').split('.');
  const secret = process.env.JWT_SECRET;
  if (!body || !signature || !secret) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}

async function issueToken(connection, { idUsuario, tipo, ttlMinutes, payload = null }) {
  const rawToken = payload
    ? createSignedPayloadToken({
        ...payload,
        sub: String(idUsuario),
        exp: Math.floor(Date.now() / 1000) + ttlMinutes * 60,
        nonce: createRawToken()
      })
    : createRawToken();
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

async function consumeToken(connection, idTokenUsuario) {
  await connection.execute(
    'UPDATE tokens_usuario SET used_at = UTC_TIMESTAMP() WHERE id_token_usuario = ?',
    [idTokenUsuario]
  );
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
  consumeToken,
  invalidateAllUserTokens,
  readSignedPayloadToken
};
