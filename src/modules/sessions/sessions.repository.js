const pool = require('../../config/db');

const SESSION_SELECT = `
  SELECT s.id_sesion_evaluacion, s.id_evaluacion_version, s.nombre, s.descripcion,
         s.imagen_url, s.tipo_sesion, s.codigo_acceso, s.programar_sesion,
         s.fecha_inicio, s.fecha_fin, s.timezone, s.aceptar_ingresos,
         s.aceptar_respuestas, s.id_pregunta_actual, s.configuracion_json,
         s.config_presentacion_json, s.created_by, s.updated_by, s.created_at,
         s.updated_at, s.deleted_at, s.deleted_by,
         ev.id_evaluacion, ev.numero_version, ev.status AS version_status,
         e.nombre AS evaluacion_nombre, e.slug AS evaluacion_slug,
         u.nombre AS creador_nombre
    FROM sesiones_evaluacion s
    INNER JOIN evaluaciones_versiones ev
      ON ev.id_evaluacion_version = s.id_evaluacion_version
    INNER JOIN evaluaciones e
      ON e.id_evaluacion = ev.id_evaluacion
    INNER JOIN usuarios u
      ON u.id_usuario = s.created_by`;

async function listSessions({ userId = null, all = false, search = '' } = {}) {
  const where = ['s.deleted_at IS NULL'];
  const params = [];

  if (!all) {
    where.push('s.created_by = ?');
    params.push(userId);
  }
  if (search) {
    where.push('(s.nombre LIKE ? OR e.nombre LIKE ? OR s.codigo_acceso LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }

  const [rows] = await pool.execute(
    `SELECT s.id_sesion_evaluacion, s.id_evaluacion_version, s.nombre, s.descripcion,
            s.imagen_url, s.tipo_sesion, s.codigo_acceso, s.programar_sesion,
            s.fecha_inicio, s.fecha_fin, s.timezone, s.aceptar_ingresos,
            s.aceptar_respuestas, s.id_pregunta_actual, s.configuracion_json,
            s.config_presentacion_json, s.created_by, s.updated_by, s.created_at,
            s.updated_at, s.deleted_at, s.deleted_by,
            ev.id_evaluacion, ev.numero_version, ev.status AS version_status,
            e.nombre AS evaluacion_nombre, e.slug AS evaluacion_slug,
            u.nombre AS creador_nombre,
            (SELECT COUNT(*)
               FROM evaluacion_aplicaciones a
              WHERE a.id_sesion_evaluacion = s.id_sesion_evaluacion
                AND a.deleted_at IS NULL) AS total_aplicaciones,
            (SELECT COUNT(*)
               FROM evaluacion_aplicaciones a
              WHERE a.id_sesion_evaluacion = s.id_sesion_evaluacion
                AND a.deleted_at IS NULL
                AND a.status = 'completada') AS total_completadas
       FROM sesiones_evaluacion s
       INNER JOIN evaluaciones_versiones ev
         ON ev.id_evaluacion_version = s.id_evaluacion_version
       INNER JOIN evaluaciones e
         ON e.id_evaluacion = ev.id_evaluacion
       INNER JOIN usuarios u
         ON u.id_usuario = s.created_by
      WHERE ${where.join(' AND ')}
      ORDER BY s.created_at DESC, s.id_sesion_evaluacion DESC
      LIMIT 250`,
    params
  );
  return rows;
}

async function findSessionById(idSession, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `${SESSION_SELECT}
       WHERE s.id_sesion_evaluacion = ?
         AND s.deleted_at IS NULL
       LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [idSession]
  );
  return rows[0] || null;
}

async function findSessionByCode(code, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `${SESSION_SELECT}
       WHERE s.codigo_acceso = ?
         AND s.deleted_at IS NULL
       LIMIT 1${lock ? ' FOR SHARE' : ''}`,
    [code]
  );
  return rows[0] || null;
}

async function listPublishedEvaluationOptions(connection = pool) {
  const [rows] = await connection.execute(
    `SELECT e.id_evaluacion, e.nombre, e.slug, e.id_version_activa,
            ev.id_evaluacion_version, ev.numero_version, ev.status, ev.config_presentacion_json
       FROM evaluaciones e
       INNER JOIN evaluaciones_versiones ev ON ev.id_evaluacion = e.id_evaluacion
      WHERE e.deleted_at IS NULL
        AND e.status = 'activa'
        AND ev.status = 'published'
      ORDER BY e.nombre ASC, ev.numero_version DESC, ev.id_evaluacion_version DESC`
  );
  return rows;
}

async function findVersionForSessionCreate(idEvaluation, idVersion = null, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT e.id_evaluacion, e.nombre AS evaluacion_nombre, e.slug AS evaluacion_slug,
            e.status AS evaluacion_status, e.id_version_activa,
            ev.id_evaluacion_version, ev.numero_version, ev.status AS version_status,
            ev.config_presentacion_json
       FROM evaluaciones e
       INNER JOIN evaluaciones_versiones ev
         ON ev.id_evaluacion = e.id_evaluacion
        AND ev.id_evaluacion_version = COALESCE(?, e.id_version_activa)
      WHERE e.id_evaluacion = ?
        AND e.deleted_at IS NULL
      LIMIT 1`,
    [idVersion, idEvaluation]
  );
  return rows[0] || null;
}

async function codeExists(code, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT id_sesion_evaluacion FROM sesiones_evaluacion WHERE codigo_acceso = ? LIMIT 1',
    [code]
  );
  return Boolean(rows[0]);
}

async function createSession(connection, input) {
  const [result] = await connection.execute(
    `INSERT INTO sesiones_evaluacion
      (id_evaluacion_version, nombre, descripcion, imagen_url, tipo_sesion, codigo_acceso,
       programar_sesion, fecha_inicio, fecha_fin, timezone, aceptar_ingresos,
       aceptar_respuestas, id_pregunta_actual, configuracion_json,
       config_presentacion_json, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      input.idVersion,
      input.nombre,
      input.descripcion,
      input.imagenUrl,
      input.tipoSesion,
      input.codigoAcceso,
      input.programarSesion ? 1 : 0,
      input.fechaInicio,
      input.fechaFin,
      input.timezone,
      input.aceptarIngresos ? 1 : 0,
      input.aceptarRespuestas ? 1 : 0,
      input.idPreguntaActual,
      JSON.stringify(input.configuracion || {}),
      JSON.stringify(input.configPresentacion || {}),
      input.userId,
      input.userId
    ]
  );
  return Number(result.insertId);
}

async function updateSession(connection, idSession, changes, userId) {
  const fields = [];
  const values = [];
  const jsonFields = new Set(['configuracion_json', 'config_presentacion_json']);

  for (const [field, value] of Object.entries(changes)) {
    fields.push(`${field} = ?`);
    values.push(jsonFields.has(field) && value !== null ? JSON.stringify(value) : value);
  }
  if (!fields.length) return;
  fields.push('updated_by = ?', 'updated_at = UTC_TIMESTAMP()');
  values.push(userId, idSession);
  await connection.execute(
    `UPDATE sesiones_evaluacion SET ${fields.join(', ')} WHERE id_sesion_evaluacion = ?`,
    values
  );
}

async function setControls(connection, idSession, { aceptarIngresos, aceptarRespuestas }, userId) {
  await connection.execute(
    `UPDATE sesiones_evaluacion
        SET aceptar_ingresos = ?, aceptar_respuestas = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ?`,
    [aceptarIngresos ? 1 : 0, aceptarRespuestas ? 1 : 0, userId, idSession]
  );
}

async function setCurrentQuestion(connection, idSession, idQuestion, userId) {
  await connection.execute(
    `UPDATE sesiones_evaluacion
        SET id_pregunta_actual = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ?`,
    [idQuestion, userId, idSession]
  );
}

async function softDeleteSession(connection, idSession, userId) {
  await connection.execute(
    `UPDATE sesiones_evaluacion
        SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ?`,
    [userId, userId, idSession]
  );
}

async function firstQuestionId(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta
       FROM preguntas
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_pregunta ASC
      LIMIT 1`,
    [idVersion]
  );
  return rows[0] ? Number(rows[0].id_pregunta) : null;
}

async function listQuestionMeta(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta, texto, tipo, valor, orden, requerida, configuracion_json
       FROM preguntas
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_pregunta ASC`,
    [idVersion]
  );
  return rows;
}

async function findQuestionById(idVersion, idQuestion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta, id_evaluacion_version, texto, tipo, valor, orden, requerida, configuracion_json
       FROM preguntas
      WHERE id_evaluacion_version = ? AND id_pregunta = ?
      LIMIT 1`,
    [idVersion, idQuestion]
  );
  return rows[0] || null;
}

async function findQuestionByOrder(idVersion, order, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta, id_evaluacion_version, texto, tipo, valor, orden, requerida, configuracion_json
       FROM preguntas
      WHERE id_evaluacion_version = ? AND orden = ?
      LIMIT 1`,
    [idVersion, order]
  );
  return rows[0] || null;
}

async function getQuestionOptions(idQuestion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_opcion, id_pregunta, texto, es_correcta, orden
       FROM opciones_pregunta
      WHERE id_pregunta = ?
      ORDER BY orden ASC, id_opcion ASC`,
    [idQuestion]
  );
  return rows;
}

async function getQuestionPublic(idVersion, idQuestion, connection = pool) {
  const question = await findQuestionById(idVersion, idQuestion, connection);
  if (!question) return null;
  const options = await getQuestionOptions(idQuestion, connection);
  return { question, options };
}

async function countQuestions(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT COUNT(*) AS total FROM preguntas WHERE id_evaluacion_version = ?',
    [idVersion]
  );
  return Number(rows[0]?.total || 0);
}

async function applicationCounts(idSession, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS total,
            SUM(status = 'por_aplicar') AS por_aplicar,
            SUM(status = 'en_progreso') AS en_progreso,
            SUM(status = 'completada') AS completadas
       FROM evaluacion_aplicaciones
      WHERE id_sesion_evaluacion = ?
        AND deleted_at IS NULL`,
    [idSession]
  );
  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    por_aplicar: Number(row.por_aplicar || 0),
    en_progreso: Number(row.en_progreso || 0),
    completadas: Number(row.completadas || 0)
  };
}

async function listLiveApplications(idSession, idCurrentQuestion = null, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT a.id_aplicacion, a.nombre, a.status, a.started_at, a.completed_at,
            a.created_at, a.updated_at,
            CASE
              WHEN ? IS NULL THEN NULL
              ELSE COALESCE(MAX(r.id_pregunta = ?), 0)
            END AS respondio_actual,
            COUNT(DISTINCT r.id_pregunta) AS respondidas,
            GREATEST(COALESCE(qt.total_preguntas, 0) - COUNT(DISTINCT r.id_pregunta), 0) AS pendientes
       FROM evaluacion_aplicaciones a
       INNER JOIN sesiones_evaluacion s
         ON s.id_sesion_evaluacion = a.id_sesion_evaluacion
       LEFT JOIN respuestas r
         ON r.id_aplicacion = a.id_aplicacion
       LEFT JOIN (
         SELECT id_evaluacion_version, COUNT(*) AS total_preguntas
           FROM preguntas
          GROUP BY id_evaluacion_version
       ) qt
         ON qt.id_evaluacion_version = s.id_evaluacion_version
      WHERE a.id_sesion_evaluacion = ?
        AND a.deleted_at IS NULL
      GROUP BY a.id_aplicacion, a.nombre, a.status, a.started_at, a.completed_at,
               a.created_at, a.updated_at, qt.total_preguntas
      ORDER BY a.created_at ASC, a.id_aplicacion ASC`,
    [idCurrentQuestion, idCurrentQuestion, idSession]
  );
  return rows;
}

async function listDeletedApplications(idSession, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_aplicacion, id_sesion_evaluacion, nombre, status,
            started_at, completed_at, created_at, updated_at, deleted_at, deleted_by
       FROM evaluacion_aplicaciones
      WHERE id_sesion_evaluacion = ?
        AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC, id_aplicacion DESC`,
    [idSession]
  );
  return rows;
}

async function findApplicationForAdminAny(idSession, idApplication, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id_aplicacion, id_sesion_evaluacion, nombre, access_token, status,
            started_at, completed_at, created_at, updated_at, deleted_at, deleted_by
       FROM evaluacion_aplicaciones
      WHERE id_sesion_evaluacion = ?
        AND id_aplicacion = ?
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [idSession, idApplication]
  );
  return rows[0] || null;
}

async function softDeleteApplication(connection, idSession, idApplication, userId) {
  const [result] = await connection.execute(
    `UPDATE evaluacion_aplicaciones
        SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ?
        AND id_aplicacion = ?
        AND deleted_at IS NULL`,
    [userId, idSession, idApplication]
  );
  return Number(result.affectedRows || 0);
}

async function restoreApplication(connection, idSession, idApplication) {
  const [result] = await connection.execute(
    `UPDATE evaluacion_aplicaciones
        SET deleted_at = NULL, deleted_by = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_sesion_evaluacion = ?
        AND id_aplicacion = ?
        AND deleted_at IS NOT NULL`,
    [idSession, idApplication]
  );
  return Number(result.affectedRows || 0);
}

async function findApplicationByToken(token, connection = pool, lock = false) {
  let applicationId = null;
  let sessionId = null;

  if (lock) {
    // Lock only the participant row exclusively. This prevents concurrent writes
    // for the same application without serializing all participants in a session.
    const [locked] = await connection.execute(
      `SELECT id_aplicacion, id_sesion_evaluacion
         FROM evaluacion_aplicaciones
        WHERE access_token = ?
          AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE`,
      [token]
    );
    if (!locked[0]) return null;
    applicationId = Number(locked[0].id_aplicacion);
    sessionId = Number(locked[0].id_sesion_evaluacion);

    // Keep session-control semantics coordinated with response writes, but use a
    // shared lock so hundreds of participants can read the same session concurrently.
    const [sessionRows] = await connection.execute(
      `SELECT id_sesion_evaluacion
         FROM sesiones_evaluacion
        WHERE id_sesion_evaluacion = ?
          AND deleted_at IS NULL
        LIMIT 1
        FOR SHARE`,
      [sessionId]
    );
    if (!sessionRows[0]) return null;
  }

  const [rows] = await connection.execute(
    `SELECT a.id_aplicacion, a.id_sesion_evaluacion, a.nombre, a.access_token,
            a.status, a.started_at, a.completed_at, a.created_at, a.updated_at,
            a.deleted_at,
            s.id_evaluacion_version, s.nombre AS sesion_nombre, s.descripcion AS sesion_descripcion,
            s.imagen_url, s.tipo_sesion, s.codigo_acceso, s.programar_sesion,
            s.fecha_inicio, s.fecha_fin, s.timezone, s.aceptar_ingresos,
            s.aceptar_respuestas, s.id_pregunta_actual, s.configuracion_json,
            s.config_presentacion_json, s.created_by, s.deleted_at AS sesion_deleted_at,
            ev.id_evaluacion, ev.numero_version, ev.status AS version_status,
            e.nombre AS evaluacion_nombre
       FROM evaluacion_aplicaciones a
       INNER JOIN sesiones_evaluacion s
         ON s.id_sesion_evaluacion = a.id_sesion_evaluacion
       INNER JOIN evaluaciones_versiones ev
         ON ev.id_evaluacion_version = s.id_evaluacion_version
       INNER JOIN evaluaciones e
         ON e.id_evaluacion = ev.id_evaluacion
      WHERE ${lock ? 'a.id_aplicacion = ?' : 'a.access_token = ?'}
        AND a.deleted_at IS NULL
        AND s.deleted_at IS NULL
      LIMIT 1`,
    [lock ? applicationId : token]
  );
  return rows[0] || null;
}

async function findApplicationForSessionToken(idSession, token, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id_aplicacion, id_sesion_evaluacion, nombre, access_token, status,
            started_at, completed_at, created_at, updated_at, deleted_at
       FROM evaluacion_aplicaciones
      WHERE id_sesion_evaluacion = ?
        AND access_token = ?
        AND deleted_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [idSession, token]
  );
  return rows[0] || null;
}

async function findApplicationForAdmin(idSession, idApplication, connection = pool, lock = false) {
  const [rows] = await connection.execute(
    `SELECT id_aplicacion, id_sesion_evaluacion, nombre, access_token, status,
            started_at, completed_at, created_at, updated_at, deleted_at
       FROM evaluacion_aplicaciones
      WHERE id_sesion_evaluacion = ?
        AND id_aplicacion = ?
        AND deleted_at IS NULL
      LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [idSession, idApplication]
  );
  return rows[0] || null;
}

async function createApplication(connection, idSession, nombre, token) {
  const [result] = await connection.execute(
    `INSERT INTO evaluacion_aplicaciones
      (id_sesion_evaluacion, nombre, access_token, status, created_at, updated_at)
     VALUES (?, ?, ?, 'por_aplicar', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [idSession, nombre, token]
  );
  return Number(result.insertId);
}

async function markApplicationStarted(connection, idApplication) {
  await connection.execute(
    `UPDATE evaluacion_aplicaciones
        SET status = 'en_progreso',
            started_at = COALESCE(started_at, UTC_TIMESTAMP()),
            completed_at = NULL,
            updated_at = UTC_TIMESTAMP()
      WHERE id_aplicacion = ?
        AND status <> 'completada'`,
    [idApplication]
  );
}

async function completeApplication(connection, idApplication) {
  await connection.execute(
    `UPDATE evaluacion_aplicaciones
        SET status = 'completada', completed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
      WHERE id_aplicacion = ?`,
    [idApplication]
  );
}

async function participantProgress(
  idApplication,
  idVersion,
  idCurrentQuestion = null,
  connection = pool,
  totalQuestions = null
) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS respondidas,
            MAX(q.orden) AS max_orden_respondida,
            CASE
              WHEN ? IS NULL THEN NULL
              ELSE COALESCE(MAX(r.id_pregunta = ?), 0)
            END AS respondio_actual
       FROM respuestas r
       INNER JOIN preguntas q ON q.id_pregunta = r.id_pregunta
      WHERE r.id_aplicacion = ?
        AND q.id_evaluacion_version = ?`,
    [idCurrentQuestion, idCurrentQuestion, idApplication, idVersion]
  );
  const row = rows[0] || {};
  const total = totalQuestions === null
    ? await countQuestions(idVersion, connection)
    : Number(totalQuestions);
  return {
    total_preguntas: Number(total || 0),
    respondidas: Number(row.respondidas || 0),
    max_orden_respondida: row.max_orden_respondida === null ? null : Number(row.max_orden_respondida),
    respondio_actual: row.respondio_actual === null ? null : Boolean(row.respondio_actual)
  };
}

async function findOldestUnansweredQuestion(idVersion, idApplication, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT q.id_pregunta, q.id_evaluacion_version, q.texto, q.tipo, q.valor,
            q.orden, q.requerida, q.configuracion_json
       FROM preguntas q
      WHERE q.id_evaluacion_version = ?
        AND NOT EXISTS (
          SELECT 1
            FROM respuestas r
           WHERE r.id_aplicacion = ?
             AND r.id_pregunta = q.id_pregunta
        )
      ORDER BY q.orden ASC, q.id_pregunta ASC
      LIMIT 1`,
    [idVersion, idApplication]
  );
  return rows[0] || null;
}

async function findResponse(idApplication, idQuestion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_respuesta, id_aplicacion, id_pregunta, valor_json, submitted_at, created_at, updated_at
       FROM respuestas
      WHERE id_aplicacion = ? AND id_pregunta = ?
      LIMIT 1`,
    [idApplication, idQuestion]
  );
  return rows[0] || null;
}

async function upsertResponse(connection, idApplication, idQuestion, value) {
  await connection.execute(
    `INSERT INTO respuestas
      (id_aplicacion, id_pregunta, valor_json, submitted_at, created_at, updated_at)
     VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       valor_json = VALUES(valor_json),
       submitted_at = UTC_TIMESTAMP(),
       updated_at = UTC_TIMESTAMP()`,
    [idApplication, idQuestion, JSON.stringify(value)]
  );
}

async function listResponses(idApplication, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT r.id_respuesta, r.id_aplicacion, r.id_pregunta, r.valor_json,
            r.submitted_at, r.created_at, r.updated_at, q.orden, q.tipo,
            q.texto, q.requerida
       FROM respuestas r
       INNER JOIN preguntas q ON q.id_pregunta = r.id_pregunta
      WHERE r.id_aplicacion = ?
      ORDER BY q.orden ASC, q.id_pregunta ASC`,
    [idApplication]
  );
  return rows;
}

async function countUnansweredForQuestion(idSession, idQuestion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) AS total
       FROM evaluacion_aplicaciones a
      WHERE a.id_sesion_evaluacion = ?
        AND a.deleted_at IS NULL
        AND a.status <> 'completada'
        AND NOT EXISTS (
          SELECT 1 FROM respuestas r
           WHERE r.id_aplicacion = a.id_aplicacion
             AND r.id_pregunta = ?
        )`,
    [idSession, idQuestion]
  );
  return Number(rows[0]?.total || 0);
}

async function getScoringData(idVersion, connection = pool) {
  const [questions] = await connection.execute(
    `SELECT id_pregunta, texto, tipo, valor, orden, requerida, configuracion_json
       FROM preguntas
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_pregunta ASC`,
    [idVersion]
  );
  const [options] = await connection.execute(
    `SELECT op.id_opcion, op.id_pregunta, op.texto, op.es_correcta, op.orden
       FROM opciones_pregunta op
       INNER JOIN preguntas q ON q.id_pregunta = op.id_pregunta
      WHERE q.id_evaluacion_version = ?
      ORDER BY op.id_pregunta ASC, op.orden ASC, op.id_opcion ASC`,
    [idVersion]
  );
  const [mappings] = await connection.execute(
    `SELECT od.id_opcion_dimension, od.id_opcion, od.id_dimension, od.valor
       FROM opciones_dimensiones od
       INNER JOIN opciones_pregunta op ON op.id_opcion = od.id_opcion
       INNER JOIN preguntas q ON q.id_pregunta = op.id_pregunta
      WHERE q.id_evaluacion_version = ?
      ORDER BY od.id_opcion ASC, od.id_opcion_dimension ASC`,
    [idVersion]
  );
  const [dimensions] = await connection.execute(
    `SELECT id_dimension, codigo, nombre, descripcion, color, icono, orden
       FROM dimensiones
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_dimension ASC`,
    [idVersion]
  );
  return { questions, options, mappings, dimensions };
}

async function upsertResult(connection, idApplication, score, maxScore, resultJson, presentationSnapshot) {
  await connection.execute(
    `INSERT INTO resultados
      (id_aplicacion, puntaje_correctas, puntaje_maximo, resultado_json,
       presentacion_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       puntaje_correctas = VALUES(puntaje_correctas),
       puntaje_maximo = VALUES(puntaje_maximo),
       resultado_json = VALUES(resultado_json),
       presentacion_snapshot_json = VALUES(presentacion_snapshot_json),
       updated_at = UTC_TIMESTAMP()`,
    [
      idApplication,
      score,
      maxScore,
      JSON.stringify(resultJson),
      presentationSnapshot === null ? null : JSON.stringify(presentationSnapshot)
    ]
  );
  const [rows] = await connection.execute(
    'SELECT id_resultado FROM resultados WHERE id_aplicacion = ? LIMIT 1',
    [idApplication]
  );
  return Number(rows[0].id_resultado);
}

async function replaceResultDimensions(connection, idResult, dimensions) {
  for (const item of dimensions) {
    await connection.execute(
      `INSERT INTO resultados_dimensiones (id_resultado, id_dimension, valor)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
      [idResult, item.id_dimension, item.valor]
    );
  }
}

async function getResultForApplication(idApplication, connection = pool) {
  const [results] = await connection.execute(
    `SELECT id_resultado, id_aplicacion, puntaje_correctas, puntaje_maximo,
            resultado_json, presentacion_snapshot_json, created_at, updated_at
       FROM resultados
      WHERE id_aplicacion = ?
      LIMIT 1`,
    [idApplication]
  );
  if (!results[0]) return null;
  const [dimensions] = await connection.execute(
    `SELECT rd.id_resultado_dimension, rd.id_resultado, rd.id_dimension, rd.valor,
            d.codigo, d.nombre, d.descripcion, d.color, d.icono, d.orden
       FROM resultados_dimensiones rd
       INNER JOIN dimensiones d ON d.id_dimension = rd.id_dimension
      WHERE rd.id_resultado = ?
      ORDER BY d.orden ASC, d.id_dimension ASC`,
    [results[0].id_resultado]
  );
  return { result: results[0], dimensions };
}

async function restartApplication(connection, idApplication) {
  await connection.execute('DELETE FROM respuestas WHERE id_aplicacion = ?', [idApplication]);
  await connection.execute('DELETE FROM resultados WHERE id_aplicacion = ?', [idApplication]);
  await connection.execute(
    `UPDATE evaluacion_aplicaciones
        SET status = 'en_progreso', started_at = UTC_TIMESTAMP(), completed_at = NULL,
            updated_at = UTC_TIMESTAMP()
      WHERE id_aplicacion = ?`,
    [idApplication]
  );
}

async function aggregateResults(idSession, connection = pool) {
  const counts = await applicationCounts(idSession, connection);
  const [dimensions] = await connection.execute(
    `SELECT d.id_dimension, d.codigo, d.nombre, d.descripcion, d.color, d.icono, d.orden,
            COALESCE(SUM(rd.valor), 0) AS valor
       FROM dimensiones d
       INNER JOIN sesiones_evaluacion s ON s.id_evaluacion_version = d.id_evaluacion_version
       LEFT JOIN evaluacion_aplicaciones a
         ON a.id_sesion_evaluacion = s.id_sesion_evaluacion
        AND a.deleted_at IS NULL
        AND a.status = 'completada'
       LEFT JOIN resultados r ON r.id_aplicacion = a.id_aplicacion
       LEFT JOIN resultados_dimensiones rd
         ON rd.id_resultado = r.id_resultado
        AND rd.id_dimension = d.id_dimension
      WHERE s.id_sesion_evaluacion = ?
      GROUP BY d.id_dimension, d.codigo, d.nombre, d.descripcion, d.color, d.icono, d.orden
      ORDER BY d.orden ASC, d.id_dimension ASC`,
    [idSession]
  );
  const [applications] = await connection.execute(
    `SELECT a.id_aplicacion, a.nombre, a.status, a.started_at, a.completed_at,
            r.id_resultado, r.puntaje_correctas, r.puntaje_maximo, r.resultado_json,
            r.presentacion_snapshot_json
       FROM evaluacion_aplicaciones a
       LEFT JOIN resultados r ON r.id_aplicacion = a.id_aplicacion
      WHERE a.id_sesion_evaluacion = ?
        AND a.deleted_at IS NULL
      ORDER BY a.created_at ASC, a.id_aplicacion ASC`,
    [idSession]
  );
  return { counts, dimensions, applications };
}

async function createEmailSend(connection, idApplication, email, snapshot) {
  const [result] = await connection.execute(
    `INSERT INTO envios_correo
      (id_aplicacion, email, status, attempt_count, resultado_snapshot_json, created_at, updated_at)
     VALUES (?, ?, 'pendiente', 0, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [idApplication, email, JSON.stringify(snapshot)]
  );
  return Number(result.insertId);
}

async function claimEmailSend(idSend, allowInProgressRetry = false) {
  const [result] = await pool.execute(
    `UPDATE envios_correo
        SET status = 'enviando', attempt_count = attempt_count + 1,
            last_attempt_at = UTC_TIMESTAMP(), error_message = NULL,
            updated_at = UTC_TIMESTAMP()
      WHERE id_envio = ?
        AND (status IN ('pendiente', 'error') OR (status = 'enviando' AND ? = 1))`,
    [idSend, allowInProgressRetry ? 1 : 0]
  );
  return result.affectedRows === 1;
}

async function markEmailPending(connection, idSend) {
  await connection.execute(
    `UPDATE envios_correo
        SET status = 'pendiente', error_message = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_envio = ? AND status = 'error'`,
    [idSend]
  );
}

async function markEmailSuccess(connection, idSend, providerMessageId = null) {
  await connection.execute(
    `UPDATE envios_correo
        SET status = 'exito', sent_at = UTC_TIMESTAMP(), provider_message_id = ?,
            error_message = NULL, updated_at = UTC_TIMESTAMP()
      WHERE id_envio = ?`,
    [providerMessageId, idSend]
  );
}

async function markEmailError(connection, idSend, message) {
  await connection.execute(
    `UPDATE envios_correo
        SET status = 'error', error_message = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_envio = ?`,
    [String(message || 'Error de envío').slice(0, 4000), idSend]
  );
}

async function findEmailSend(idSession, idSend, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT ec.id_envio, ec.id_aplicacion, ec.email, ec.status, ec.attempt_count,
            ec.last_attempt_at, ec.sent_at, ec.provider_message_id, ec.error_message,
            ec.resultado_snapshot_json, ec.created_at, ec.updated_at,
            a.nombre AS aplicacion_nombre, a.id_sesion_evaluacion
       FROM envios_correo ec
       INNER JOIN evaluacion_aplicaciones a ON a.id_aplicacion = ec.id_aplicacion
      WHERE ec.id_envio = ?
        AND a.id_sesion_evaluacion = ?
      LIMIT 1`,
    [idSend, idSession]
  );
  return rows[0] || null;
}

async function findEmailSendForWorker(idSend, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT ec.id_envio, ec.id_aplicacion, ec.email, ec.status, ec.attempt_count,
            ec.last_attempt_at, ec.sent_at, ec.provider_message_id, ec.error_message,
            ec.resultado_snapshot_json, ec.created_at, ec.updated_at,
            a.nombre AS aplicacion_nombre, a.id_sesion_evaluacion,
            s.nombre AS sesion_nombre, e.nombre AS evaluacion_nombre
       FROM envios_correo ec
       INNER JOIN evaluacion_aplicaciones a ON a.id_aplicacion = ec.id_aplicacion
       INNER JOIN sesiones_evaluacion s ON s.id_sesion_evaluacion = a.id_sesion_evaluacion
       INNER JOIN evaluaciones_versiones ev ON ev.id_evaluacion_version = s.id_evaluacion_version
       INNER JOIN evaluaciones e ON e.id_evaluacion = ev.id_evaluacion
      WHERE ec.id_envio = ?
      LIMIT 1`,
    [idSend]
  );
  return rows[0] || null;
}

async function listEmailSends(idSession, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT ec.id_envio, ec.id_aplicacion, a.nombre AS aplicacion_nombre,
            ec.email, ec.status, ec.attempt_count, ec.last_attempt_at, ec.sent_at,
            ec.provider_message_id, ec.error_message, ec.created_at, ec.updated_at
       FROM envios_correo ec
       INNER JOIN evaluacion_aplicaciones a ON a.id_aplicacion = ec.id_aplicacion
      WHERE a.id_sesion_evaluacion = ?
      ORDER BY ec.created_at DESC, ec.id_envio DESC`,
    [idSession]
  );
  return rows;
}

module.exports = {
  pool,
  listSessions,
  findSessionById,
  findSessionByCode,
  listPublishedEvaluationOptions,
  findVersionForSessionCreate,
  codeExists,
  createSession,
  updateSession,
  setControls,
  setCurrentQuestion,
  softDeleteSession,
  firstQuestionId,
  listQuestionMeta,
  findQuestionById,
  findQuestionByOrder,
  getQuestionOptions,
  getQuestionPublic,
  countQuestions,
  applicationCounts,
  listLiveApplications,
  listDeletedApplications,
  findApplicationForAdminAny,
  softDeleteApplication,
  restoreApplication,
  findApplicationByToken,
  findApplicationForSessionToken,
  findApplicationForAdmin,
  createApplication,
  markApplicationStarted,
  completeApplication,
  participantProgress,
  findOldestUnansweredQuestion,
  findResponse,
  upsertResponse,
  listResponses,
  countUnansweredForQuestion,
  getScoringData,
  upsertResult,
  replaceResultDimensions,
  getResultForApplication,
  restartApplication,
  aggregateResults,
  createEmailSend,
  claimEmailSend,
  markEmailPending,
  markEmailSuccess,
  markEmailError,
  findEmailSend,
  findEmailSendForWorker,
  listEmailSends
};
