const pool = require('../../config/db');

async function listEvaluations(search = '') {
  const term = String(search || '').trim();
  const like = `%${term}%`;
  const [rows] = await pool.execute(
    `SELECT
       e.id_evaluacion,
       e.nombre,
       e.slug,
       e.descripcion,
       e.status,
       e.id_version_activa,
       e.created_by,
       e.updated_by,
       e.created_at,
       e.updated_at,
       av.numero_version AS version_activa_numero,
       av.status AS version_activa_status,
       (SELECT COUNT(*) FROM evaluaciones_versiones v WHERE v.id_evaluacion = e.id_evaluacion) AS total_versiones,
       (SELECT MAX(v2.id_evaluacion_version)
          FROM evaluaciones_versiones v2
         WHERE v2.id_evaluacion = e.id_evaluacion AND v2.status = 'draft') AS id_version_draft
     FROM evaluaciones e
     LEFT JOIN evaluaciones_versiones av
       ON av.id_evaluacion_version = e.id_version_activa
     WHERE e.deleted_at IS NULL
       AND (? = '' OR e.nombre LIKE ? OR e.slug LIKE ? OR e.descripcion LIKE ?)
     ORDER BY e.updated_at DESC, e.id_evaluacion DESC`,
    [term, like, like, like]
  );
  return rows;
}

async function findEvaluationById(idEvaluacion, connection = pool, forUpdate = false) {
  const [rows] = await connection.execute(
    `SELECT
       id_evaluacion, nombre, slug, descripcion, status, id_version_activa,
       created_by, updated_by, created_at, updated_at, deleted_at, deleted_by
     FROM evaluaciones
     WHERE id_evaluacion = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [idEvaluacion]
  );
  return rows[0] || null;
}

async function slugExists(slug, excludeId = null, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_evaluacion
       FROM evaluaciones
      WHERE slug = ?
        AND (? IS NULL OR id_evaluacion <> ?)
      LIMIT 1`,
    [slug, excludeId, excludeId]
  );
  return Boolean(rows[0]);
}

async function createEvaluation(connection, input, userId) {
  const [result] = await connection.execute(
    `INSERT INTO evaluaciones
      (nombre, slug, descripcion, status, id_version_activa,
       created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, 'activa', NULL, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [input.nombre, input.slug, input.descripcion, userId, userId]
  );
  return result.insertId;
}

async function updateEvaluation(connection, idEvaluacion, changes, userId) {
  const fields = [];
  const values = [];
  for (const [field, value] of Object.entries(changes)) {
    fields.push(`${field} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  fields.push('updated_by = ?');
  values.push(userId);
  values.push(idEvaluacion);
  await connection.execute(
    `UPDATE evaluaciones
        SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion = ?`,
    values
  );
}

async function softDeleteEvaluation(connection, idEvaluacion, userId) {
  await connection.execute(
    `UPDATE evaluaciones
        SET deleted_at = UTC_TIMESTAMP(), deleted_by = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion = ?`,
    [userId, userId, idEvaluacion]
  );
}

async function listVersions(idEvaluacion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT
       v.id_evaluacion_version,
       v.id_evaluacion,
       v.numero_version,
       v.status,
       v.config_presentacion_json,
       v.created_by,
       v.updated_by,
       v.created_at,
       v.updated_at,
       v.published_at,
       CASE WHEN e.id_version_activa = v.id_evaluacion_version THEN 1 ELSE 0 END AS es_activa,
       (SELECT COUNT(*) FROM preguntas p WHERE p.id_evaluacion_version = v.id_evaluacion_version) AS total_preguntas,
       (SELECT COUNT(*) FROM dimensiones d WHERE d.id_evaluacion_version = v.id_evaluacion_version) AS total_dimensiones
     FROM evaluaciones_versiones v
     INNER JOIN evaluaciones e ON e.id_evaluacion = v.id_evaluacion
     WHERE v.id_evaluacion = ?
     ORDER BY v.numero_version DESC, v.id_evaluacion_version DESC`,
    [idEvaluacion]
  );
  return rows;
}

async function findVersion(idEvaluacion, idVersion, connection = pool, forUpdate = false) {
  const [rows] = await connection.execute(
    `SELECT
       id_evaluacion_version, id_evaluacion, numero_version, status,
       config_presentacion_json, created_by, updated_by, created_at, updated_at, published_at
     FROM evaluaciones_versiones
     WHERE id_evaluacion = ? AND id_evaluacion_version = ?
     LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
    [idEvaluacion, idVersion]
  );
  return rows[0] || null;
}

async function nextVersionNumber(connection, idEvaluacion) {
  const [rows] = await connection.execute(
    `SELECT COALESCE(MAX(numero_version), 0) + 1 AS next_number
       FROM evaluaciones_versiones
      WHERE id_evaluacion = ?`,
    [idEvaluacion]
  );
  return Number(rows[0]?.next_number || 1);
}

async function createVersion(connection, { idEvaluacion, numeroVersion, configPresentacion = null, userId }) {
  const [result] = await connection.execute(
    `INSERT INTO evaluaciones_versiones
      (id_evaluacion, numero_version, status, config_presentacion_json,
       created_by, updated_by, created_at, updated_at, published_at)
     VALUES (?, ?, 'draft', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP(), NULL)`,
    [idEvaluacion, numeroVersion, configPresentacion ? JSON.stringify(configPresentacion) : null, userId, userId]
  );
  return result.insertId;
}

async function updateVersionPresentation(connection, idVersion, config, userId) {
  await connection.execute(
    `UPDATE evaluaciones_versiones
        SET config_presentacion_json = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion_version = ?`,
    [config ? JSON.stringify(config) : null, userId, idVersion]
  );
}

async function markVersionPublished(connection, idVersion, userId) {
  await connection.execute(
    `UPDATE evaluaciones_versiones
        SET status = 'published', published_at = UTC_TIMESTAMP(), updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion_version = ?`,
    [userId, idVersion]
  );
}

async function markVersionRetired(connection, idVersion, userId) {
  await connection.execute(
    `UPDATE evaluaciones_versiones
        SET status = 'retired', updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion_version = ?`,
    [userId, idVersion]
  );
}

async function setActiveVersion(connection, idEvaluacion, idVersion, userId) {
  await connection.execute(
    `UPDATE evaluaciones
        SET id_version_activa = ?, updated_by = ?, updated_at = UTC_TIMESTAMP()
      WHERE id_evaluacion = ?`,
    [idVersion, userId, idEvaluacion]
  );
}

async function getEditorData(idEvaluacion, idVersion, connection = pool) {
  const evaluation = await findEvaluationById(idEvaluacion, connection);
  if (!evaluation || evaluation.deleted_at) return null;
  const version = await findVersion(idEvaluacion, idVersion, connection);
  if (!version) return null;

  const [dimensions] = await connection.execute(
    `SELECT id_dimension, id_evaluacion_version, codigo, nombre, descripcion, color, icono,
            orden, configuracion_json, created_at, updated_at
       FROM dimensiones
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_dimension ASC`,
    [idVersion]
  );

  const [questions] = await connection.execute(
    `SELECT id_pregunta, id_evaluacion_version, texto, tipo, valor, orden, requerida,
            configuracion_json, created_at, updated_at
       FROM preguntas
      WHERE id_evaluacion_version = ?
      ORDER BY orden ASC, id_pregunta ASC`,
    [idVersion]
  );

  const questionIds = questions.map((q) => q.id_pregunta);
  let options = [];
  let mappings = [];
  if (questionIds.length) {
    const placeholders = questionIds.map(() => '?').join(',');
    const [optionRows] = await connection.execute(
      `SELECT id_opcion, id_pregunta, texto, es_correcta, orden, created_at, updated_at
         FROM opciones_pregunta
        WHERE id_pregunta IN (${placeholders})
        ORDER BY id_pregunta ASC, orden ASC, id_opcion ASC`,
      questionIds
    );
    options = optionRows;
    const optionIds = options.map((o) => o.id_opcion);
    if (optionIds.length) {
      const optionPlaceholders = optionIds.map(() => '?').join(',');
      const [mappingRows] = await connection.execute(
        `SELECT id_opcion_dimension, id_opcion, id_dimension, valor
           FROM opciones_dimensiones
          WHERE id_opcion IN (${optionPlaceholders})
          ORDER BY id_opcion ASC, id_opcion_dimension ASC`,
        optionIds
      );
      mappings = mappingRows;
    }
  }

  return { evaluation, version, dimensions, questions, options, mappings };
}


async function dimensionCodeExists(idVersion, code, excludeId = null, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_dimension
       FROM dimensiones
      WHERE id_evaluacion_version = ?
        AND codigo = ?
        AND (? IS NULL OR id_dimension <> ?)
      LIMIT 1`,
    [idVersion, code, excludeId, excludeId]
  );
  return Boolean(rows[0]);
}

async function createDimension(connection, idVersion, input) {
  const [result] = await connection.execute(
    `INSERT INTO dimensiones
      (id_evaluacion_version, codigo, nombre, descripcion, color, icono, orden,
       configuracion_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      idVersion,
      input.codigo,
      input.nombre,
      input.descripcion,
      input.color,
      input.icono,
      input.orden,
      input.configuracion ? JSON.stringify(input.configuracion) : null
    ]
  );
  return result.insertId;
}

async function findDimension(idVersion, idDimension, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_dimension, id_evaluacion_version, codigo, nombre, descripcion, color, icono,
            orden, configuracion_json, created_at, updated_at
       FROM dimensiones
      WHERE id_evaluacion_version = ? AND id_dimension = ?
      LIMIT 1`,
    [idVersion, idDimension]
  );
  return rows[0] || null;
}

async function updateDimension(connection, idDimension, changes) {
  const fields = [];
  const values = [];
  for (const [field, value] of Object.entries(changes)) {
    fields.push(`${field} = ?`);
    values.push(field === 'configuracion_json' && value !== null ? JSON.stringify(value) : value);
  }
  if (!fields.length) return;
  values.push(idDimension);
  await connection.execute(
    `UPDATE dimensiones SET ${fields.join(', ')}, updated_at = UTC_TIMESTAMP() WHERE id_dimension = ?`,
    values
  );
}

async function deleteDimension(connection, idDimension) {
  await connection.execute('DELETE FROM opciones_dimensiones WHERE id_dimension = ?', [idDimension]);
  await connection.execute('DELETE FROM dimensiones WHERE id_dimension = ?', [idDimension]);
}

async function dimensionIdsForVersion(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT id_dimension FROM dimensiones WHERE id_evaluacion_version = ? ORDER BY orden, id_dimension',
    [idVersion]
  );
  return rows.map((r) => Number(r.id_dimension));
}

async function reorderDimensions(connection, orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    await connection.execute(
      'UPDATE dimensiones SET orden = ?, updated_at = UTC_TIMESTAMP() WHERE id_dimension = ?',
      [i + 1, orderedIds[i]]
    );
  }
}

async function createQuestion(connection, idVersion, input) {
  const [result] = await connection.execute(
    `INSERT INTO preguntas
      (id_evaluacion_version, texto, tipo, valor, orden, requerida, configuracion_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [
      idVersion,
      input.texto,
      input.tipo,
      input.valor,
      input.orden,
      input.requerida ? 1 : 0,
      input.configuracion ? JSON.stringify(input.configuracion) : null
    ]
  );
  return result.insertId;
}

async function findQuestion(idVersion, idQuestion, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta, id_evaluacion_version, texto, tipo, valor, orden, requerida,
            configuracion_json, created_at, updated_at
       FROM preguntas
      WHERE id_evaluacion_version = ? AND id_pregunta = ?
      LIMIT 1`,
    [idVersion, idQuestion]
  );
  return rows[0] || null;
}

async function updateQuestion(connection, idQuestion, input) {
  await connection.execute(
    `UPDATE preguntas
        SET texto = ?, tipo = ?, valor = ?, orden = ?, requerida = ?, configuracion_json = ?,
            updated_at = UTC_TIMESTAMP()
      WHERE id_pregunta = ?`,
    [
      input.texto,
      input.tipo,
      input.valor,
      input.orden,
      input.requerida ? 1 : 0,
      input.configuracion ? JSON.stringify(input.configuracion) : null,
      idQuestion
    ]
  );
}

async function deleteQuestionOptions(connection, idQuestion) {
  await connection.execute(
    `DELETE od FROM opciones_dimensiones od
      INNER JOIN opciones_pregunta op ON op.id_opcion = od.id_opcion
     WHERE op.id_pregunta = ?`,
    [idQuestion]
  );
  await connection.execute('DELETE FROM opciones_pregunta WHERE id_pregunta = ?', [idQuestion]);
}

async function deleteQuestion(connection, idQuestion) {
  await deleteQuestionOptions(connection, idQuestion);
  await connection.execute('DELETE FROM preguntas WHERE id_pregunta = ?', [idQuestion]);
}

async function insertOption(connection, idQuestion, option) {
  const [result] = await connection.execute(
    `INSERT INTO opciones_pregunta
      (id_pregunta, texto, es_correcta, orden, created_at, updated_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
    [idQuestion, option.texto, option.es_correcta ? 1 : 0, option.orden]
  );
  return result.insertId;
}

async function insertOptionDimension(connection, idOption, relation) {
  await connection.execute(
    `INSERT INTO opciones_dimensiones
      (id_opcion, id_dimension, valor)
     VALUES (?, ?, ?)`,
    [idOption, relation.id_dimension, relation.valor]
  );
}

async function questionIdsForVersion(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT id_pregunta FROM preguntas WHERE id_evaluacion_version = ? ORDER BY orden, id_pregunta',
    [idVersion]
  );
  return rows.map((r) => Number(r.id_pregunta));
}

async function maxQuestionOrder(idVersion, connection = pool) {
  const [rows] = await connection.execute(
    'SELECT COALESCE(MAX(orden), 0) AS max_orden FROM preguntas WHERE id_evaluacion_version = ?',
    [idVersion]
  );
  return Number(rows[0]?.max_orden || 0);
}

async function questionOrderExists(idVersion, order, excludeId = null, connection = pool) {
  const [rows] = await connection.execute(
    `SELECT id_pregunta
       FROM preguntas
      WHERE id_evaluacion_version = ?
        AND orden = ?
        AND (? IS NULL OR id_pregunta <> ?)
      LIMIT 1`,
    [idVersion, order, excludeId, excludeId]
  );
  return Boolean(rows[0]);
}

async function reorderQuestions(connection, idVersion, orderedIds) {
  const maxOrder = await maxQuestionOrder(idVersion, connection);
  const tempStart = maxOrder + orderedIds.length + 1;

  // Dos fases para no chocar con uq_pregunta_version_orden al intercambiar posiciones.
  for (let i = 0; i < orderedIds.length; i += 1) {
    await connection.execute(
      'UPDATE preguntas SET orden = ?, updated_at = UTC_TIMESTAMP() WHERE id_pregunta = ?',
      [tempStart + i, orderedIds[i]]
    );
  }

  for (let i = 0; i < orderedIds.length; i += 1) {
    await connection.execute(
      'UPDATE preguntas SET orden = ?, updated_at = UTC_TIMESTAMP() WHERE id_pregunta = ?',
      [i + 1, orderedIds[i]]
    );
  }
}

async function copyDimensions(connection, sourceVersionId, targetVersionId) {
  const [rows] = await connection.execute(
    `SELECT id_dimension, codigo, nombre, descripcion, color, icono, orden, configuracion_json
       FROM dimensiones
      WHERE id_evaluacion_version = ?
      ORDER BY orden, id_dimension`,
    [sourceVersionId]
  );
  const map = new Map();
  for (const row of rows) {
    const [result] = await connection.execute(
      `INSERT INTO dimensiones
        (id_evaluacion_version, codigo, nombre, descripcion, color, icono, orden,
         configuracion_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [targetVersionId, row.codigo, row.nombre, row.descripcion, row.color, row.icono, row.orden, row.configuracion_json]
    );
    map.set(Number(row.id_dimension), Number(result.insertId));
  }
  return map;
}

async function copyQuestions(connection, sourceVersionId, targetVersionId, dimensionMap) {
  const [questions] = await connection.execute(
    `SELECT id_pregunta, texto, tipo, valor, orden, requerida, configuracion_json
       FROM preguntas
      WHERE id_evaluacion_version = ?
      ORDER BY orden, id_pregunta`,
    [sourceVersionId]
  );

  for (const q of questions) {
    const [qResult] = await connection.execute(
      `INSERT INTO preguntas
        (id_evaluacion_version, texto, tipo, valor, orden, requerida, configuracion_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [targetVersionId, q.texto, q.tipo, q.valor, q.orden, q.requerida, q.configuracion_json]
    );
    const newQuestionId = qResult.insertId;

    const [options] = await connection.execute(
      `SELECT id_opcion, texto, es_correcta, orden
         FROM opciones_pregunta
        WHERE id_pregunta = ?
        ORDER BY orden, id_opcion`,
      [q.id_pregunta]
    );

    for (const option of options) {
      const [oResult] = await connection.execute(
        `INSERT INTO opciones_pregunta
          (id_pregunta, texto, es_correcta, orden, created_at, updated_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [newQuestionId, option.texto, option.es_correcta, option.orden]
      );
      const [relations] = await connection.execute(
        `SELECT id_dimension, valor FROM opciones_dimensiones WHERE id_opcion = ?`,
        [option.id_opcion]
      );
      for (const rel of relations) {
        const newDimensionId = dimensionMap.get(Number(rel.id_dimension));
        if (newDimensionId) {
          await connection.execute(
            'INSERT INTO opciones_dimensiones (id_opcion, id_dimension, valor) VALUES (?, ?, ?)',
            [oResult.insertId, newDimensionId, rel.valor]
          );
        }
      }
    }
  }
}

module.exports = {
  pool,
  listEvaluations,
  findEvaluationById,
  slugExists,
  createEvaluation,
  updateEvaluation,
  softDeleteEvaluation,
  listVersions,
  findVersion,
  nextVersionNumber,
  createVersion,
  updateVersionPresentation,
  markVersionPublished,
  markVersionRetired,
  setActiveVersion,
  getEditorData,
  dimensionCodeExists,
  createDimension,
  findDimension,
  updateDimension,
  deleteDimension,
  dimensionIdsForVersion,
  reorderDimensions,
  createQuestion,
  findQuestion,
  updateQuestion,
  deleteQuestionOptions,
  deleteQuestion,
  insertOption,
  insertOptionDimension,
  questionIdsForVersion,
  maxQuestionOrder,
  questionOrderExists,
  reorderQuestions,
  copyDimensions,
  copyQuestions
};
