const pool = require('../../config/db');

async function listTrash({ userId, all }) {
  let evaluations = [];
  let versions = [];

  if (all) {
    [evaluations] = await pool.execute(
      `SELECT e.id_evaluacion, e.nombre, e.slug, e.deleted_at, e.deleted_by,
              u.nombre AS deleted_by_nombre,
              (SELECT COUNT(*) FROM evaluaciones_versiones v WHERE v.id_evaluacion = e.id_evaluacion) AS total_versiones,
              (SELECT COUNT(*)
                 FROM sesiones_evaluacion s
                 INNER JOIN evaluaciones_versiones v ON v.id_evaluacion_version = s.id_evaluacion_version
                WHERE v.id_evaluacion = e.id_evaluacion) AS total_sesiones
         FROM evaluaciones e
         LEFT JOIN usuarios u ON u.id_usuario = e.deleted_by
        WHERE e.deleted_at IS NOT NULL
        ORDER BY e.deleted_at DESC, e.id_evaluacion DESC`
    );

    [versions] = await pool.execute(
      `SELECT v.id_evaluacion_version, v.id_evaluacion, v.numero_version, v.status,
              e.nombre AS evaluacion_nombre,
              COALESCE(v.deleted_at, e.deleted_at) AS deleted_at,
              COALESCE(v.deleted_by, e.deleted_by) AS deleted_by,
              u.nombre AS deleted_by_nombre,
              CASE WHEN v.deleted_at IS NOT NULL THEN 'version' ELSE 'evaluacion' END AS deleted_origin,
              CASE WHEN v.deleted_at IS NOT NULL AND e.deleted_at IS NULL THEN 1 ELSE 0 END AS can_restore,
              (SELECT COUNT(*) FROM sesiones_evaluacion s WHERE s.id_evaluacion_version = v.id_evaluacion_version) AS total_sesiones
         FROM evaluaciones_versiones v
         INNER JOIN evaluaciones e ON e.id_evaluacion = v.id_evaluacion
         LEFT JOIN usuarios u ON u.id_usuario = COALESCE(v.deleted_by, e.deleted_by)
        WHERE v.deleted_at IS NOT NULL OR e.deleted_at IS NOT NULL
        ORDER BY COALESCE(v.deleted_at, e.deleted_at) DESC, v.id_evaluacion_version DESC`
    );
  }

  const sessionWhere = all
    ? '(s.deleted_at IS NOT NULL OR v.deleted_at IS NOT NULL OR e.deleted_at IS NOT NULL)'
    : 's.created_by = ? AND (s.deleted_at IS NOT NULL OR v.deleted_at IS NOT NULL OR e.deleted_at IS NOT NULL)';
  const params = all ? [] : [userId];

  const [sessions] = await pool.execute(
    `SELECT s.id_sesion_evaluacion, s.id_evaluacion_version, s.nombre, s.tipo_sesion,
            s.created_by, v.numero_version, e.id_evaluacion, e.nombre AS evaluacion_nombre,
            COALESCE(s.deleted_at, v.deleted_at, e.deleted_at) AS deleted_at,
            COALESCE(s.deleted_by, v.deleted_by, e.deleted_by) AS deleted_by,
            u.nombre AS deleted_by_nombre,
            CASE
              WHEN s.deleted_at IS NOT NULL THEN 'sesion'
              WHEN v.deleted_at IS NOT NULL THEN 'version'
              ELSE 'evaluacion'
            END AS deleted_origin,
            CASE
              WHEN s.deleted_at IS NOT NULL AND v.deleted_at IS NULL AND e.deleted_at IS NULL THEN 1
              ELSE 0
            END AS can_restore,
            (SELECT COUNT(*) FROM evaluacion_aplicaciones a WHERE a.id_sesion_evaluacion = s.id_sesion_evaluacion) AS total_aplicaciones
       FROM sesiones_evaluacion s
       INNER JOIN evaluaciones_versiones v ON v.id_evaluacion_version = s.id_evaluacion_version
       INNER JOIN evaluaciones e ON e.id_evaluacion = v.id_evaluacion
       LEFT JOIN usuarios u ON u.id_usuario = COALESCE(s.deleted_by, v.deleted_by, e.deleted_by)
      WHERE ${sessionWhere}
      ORDER BY COALESCE(s.deleted_at, v.deleted_at, e.deleted_at) DESC, s.id_sesion_evaluacion DESC`,
    params
  );

  return { evaluations, versions, sessions };
}

async function findEvaluation(id, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id_evaluacion, nombre, deleted_at, deleted_by
       FROM evaluaciones
      WHERE id_evaluacion = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
}

async function findVersion(id, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT v.id_evaluacion_version, v.id_evaluacion, v.numero_version, v.deleted_at, v.deleted_by,
            e.deleted_at AS evaluacion_deleted_at
       FROM evaluaciones_versiones v
       INNER JOIN evaluaciones e ON e.id_evaluacion = v.id_evaluacion
      WHERE v.id_evaluacion_version = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
}

async function findSession(id, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT s.id_sesion_evaluacion, s.id_evaluacion_version, s.nombre, s.created_by,
            s.deleted_at, s.deleted_by,
            v.deleted_at AS version_deleted_at,
            e.deleted_at AS evaluacion_deleted_at
       FROM sesiones_evaluacion s
       INNER JOIN evaluaciones_versiones v ON v.id_evaluacion_version = s.id_evaluacion_version
       INNER JOIN evaluaciones e ON e.id_evaluacion = v.id_evaluacion
      WHERE s.id_sesion_evaluacion = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
}

async function restoreEvaluation(connection, id) {
  const [result] = await connection.execute(
    `UPDATE evaluaciones
        SET deleted_at = NULL, deleted_by = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  return Number(result.affectedRows || 0);
}

async function restoreVersion(connection, id) {
  const [result] = await connection.execute(
    `UPDATE evaluaciones_versiones
        SET deleted_at = NULL, deleted_by = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion_version = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  return Number(result.affectedRows || 0);
}

async function restoreSession(connection, id) {
  const [result] = await connection.execute(
    `UPDATE sesiones_evaluacion
        SET deleted_at = NULL, deleted_by = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ? AND deleted_at IS NOT NULL`,
    [id]
  );
  return Number(result.affectedRows || 0);
}

async function purgeSession(connection, id) {
  const [result] = await connection.execute(
    'DELETE FROM sesiones_evaluacion WHERE id_sesion_evaluacion = ?',
    [id]
  );
  return Number(result.affectedRows || 0);
}

async function purgeVersion(connection, id) {
  await connection.execute(
    `UPDATE evaluaciones e
       INNER JOIN evaluaciones_versiones v ON v.id_evaluacion = e.id_evaluacion
          SET e.id_version_activa = NULL, e.updated_at = UTC_TIMESTAMP()
     WHERE v.id_evaluacion_version = ? AND e.id_version_activa = ?`,
    [id, id]
  );
  await connection.execute('DELETE FROM sesiones_evaluacion WHERE id_evaluacion_version = ?', [id]);
  const [result] = await connection.execute(
    'DELETE FROM evaluaciones_versiones WHERE id_evaluacion_version = ?',
    [id]
  );
  return Number(result.affectedRows || 0);
}

async function purgeEvaluation(connection, id) {
  await connection.execute(
    'UPDATE evaluaciones SET id_version_activa = NULL, updated_at = UTC_TIMESTAMP() WHERE id_evaluacion = ?',
    [id]
  );
  await connection.execute(
    `DELETE s
       FROM sesiones_evaluacion s
       INNER JOIN evaluaciones_versiones v ON v.id_evaluacion_version = s.id_evaluacion_version
      WHERE v.id_evaluacion = ?`,
    [id]
  );
  const [result] = await connection.execute(
    'DELETE FROM evaluaciones WHERE id_evaluacion = ?',
    [id]
  );
  return Number(result.affectedRows || 0);
}

module.exports = {
  pool,
  listTrash,
  findEvaluation,
  findVersion,
  findSession,
  restoreEvaluation,
  restoreVersion,
  restoreSession,
  purgeEvaluation,
  purgeVersion,
  purgeSession
};
