const repository = require('./evaluations.repository');
const { AppError } = require('../../utils/app-error');

const VALID_EVALUATION_STATUS = new Set(['activa', 'inactiva']);
const VALID_QUESTION_TYPES = new Set(['single_choice', 'multiple_choice', 'ranking']);

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeEvaluation(row) {
  if (!row) return null;
  return {
    ...row,
    id_evaluacion: Number(row.id_evaluacion),
    id_version_activa: row.id_version_activa === null ? null : Number(row.id_version_activa),
    total_versiones: row.total_versiones === undefined ? undefined : Number(row.total_versiones),
    id_version_draft: row.id_version_draft === null || row.id_version_draft === undefined ? null : Number(row.id_version_draft)
  };
}

function normalizeVersion(row, activeVersionId = null) {
  if (!row) return null;
  return {
    ...row,
    id_evaluacion_version: Number(row.id_evaluacion_version),
    id_evaluacion: Number(row.id_evaluacion),
    numero_version: Number(row.numero_version),
    es_activa: row.es_activa !== undefined ? Boolean(row.es_activa) : Number(activeVersionId) === Number(row.id_evaluacion_version),
    editable: row.status === 'draft',
    config_presentacion: parseJson(row.config_presentacion_json, {}),
    config_presentacion_json: undefined,
    total_preguntas: row.total_preguntas === undefined ? undefined : Number(row.total_preguntas),
    total_dimensiones: row.total_dimensiones === undefined ? undefined : Number(row.total_dimensiones)
  };
}

function normalizeDimension(row) {
  return {
    ...row,
    id_dimension: Number(row.id_dimension),
    id_evaluacion_version: Number(row.id_evaluacion_version),
    orden: Number(row.orden || 0),
    configuracion: parseJson(row.configuracion_json, {}),
    configuracion_json: undefined
  };
}

function normalizeQuestion(row, options = []) {
  return {
    ...row,
    id_pregunta: Number(row.id_pregunta),
    id_evaluacion_version: Number(row.id_evaluacion_version),
    valor: Number(row.valor || 0),
    orden: Number(row.orden || 0),
    requerida: Boolean(row.requerida),
    configuracion: parseJson(row.configuracion_json, {}),
    configuracion_json: undefined,
    opciones: options
  };
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140) || 'evaluacion';
}

async function uniqueSlug(base, excludeId = null, connection = repository.pool) {
  const root = slugify(base);
  let candidate = root;
  let suffix = 2;
  while (await repository.slugExists(candidate, excludeId, connection)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function assertEvaluationActiveRecord(evaluation) {
  if (!evaluation || evaluation.deleted_at) {
    throw new AppError(404, 'EVALUATION_NOT_FOUND', 'Evaluación no encontrada.');
  }
}

function assertDraft(version) {
  if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Versión no encontrada.');
  if (version.status !== 'draft') {
    throw new AppError(409, 'VERSION_IMMUTABLE', 'Solo las versiones en borrador se pueden modificar.');
  }
}

function sanitizeEvaluationInput(input, partial = false) {
  const out = {};
  if (!partial || input.nombre !== undefined) {
    const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : '';
    if (!nombre || nombre.length > 180) throw new AppError(400, 'INVALID_EVALUATION_NAME', 'El nombre de la evaluación no es válido.');
    out.nombre = nombre;
  }
  if (input.descripcion !== undefined) {
    if (input.descripcion !== null && typeof input.descripcion !== 'string') throw new AppError(400, 'INVALID_EVALUATION_DESCRIPTION', 'La descripción no es válida.');
    out.descripcion = input.descripcion === null ? null : input.descripcion.trim().slice(0, 4000);
  } else if (!partial) out.descripcion = null;
  if (input.status !== undefined) {
    if (!VALID_EVALUATION_STATUS.has(input.status)) throw new AppError(400, 'INVALID_EVALUATION_STATUS', 'El status debe ser activa o inactiva.');
    out.status = input.status;
  }
  return out;
}

async function listEvaluations(search) {
  const rows = await repository.listEvaluations(search);
  return rows.map((row) => {
    const item = normalizeEvaluation(row);
    item.version_activa = row.id_version_activa ? {
      id_evaluacion_version: Number(row.id_version_activa),
      numero_version: row.version_activa_numero === null ? null : Number(row.version_activa_numero),
      status: row.version_activa_status
    } : null;
    delete item.version_activa_numero;
    delete item.version_activa_status;
    return item;
  });
}

async function getEvaluation(idEvaluacion) {
  const evaluation = await repository.findEvaluationById(idEvaluacion);
  assertEvaluationActiveRecord(evaluation);
  const versions = await repository.listVersions(idEvaluacion);
  return {
    evaluacion: normalizeEvaluation(evaluation),
    versiones: versions.map((v) => normalizeVersion(v, evaluation.id_version_activa))
  };
}

async function createEvaluation(input, userId) {
  const allowed = new Set(['nombre', 'slug', 'descripcion']);
  const keys = Object.keys(input || {});
  if (keys.some((k) => !allowed.has(k))) {
    throw new AppError(400, 'INVALID_EVALUATION_CREATE', 'La evaluación contiene campos no permitidos.');
  }
  if (input.slug !== undefined && (typeof input.slug !== 'string' || !input.slug.trim())) {
    throw new AppError(400, 'INVALID_EVALUATION_SLUG', 'El slug no es válido.');
  }
  const clean = sanitizeEvaluationInput(input, false);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const requestedSlug = typeof input.slug === 'string' && input.slug.trim() ? input.slug : clean.nombre;
    clean.slug = await uniqueSlug(requestedSlug, null, connection);
    const idEvaluacion = await repository.createEvaluation(connection, clean, userId);
    const idVersion = await repository.createVersion(connection, {
      idEvaluacion,
      numeroVersion: 1,
      configPresentacion: {},
      userId
    });
    await connection.commit();
    const result = await getEvaluation(idEvaluacion);
    return {
      evaluacion: result.evaluacion,
      version: result.versiones.find((v) => v.id_evaluacion_version === Number(idVersion))
    };
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'EVALUATION_SLUG_EXISTS', 'Ya existe una evaluación con ese slug.');
    throw error;
  } finally {
    connection.release();
  }
}

async function updateEvaluation(idEvaluacion, input, userId) {
  const allowed = new Set(['nombre', 'slug', 'descripcion', 'status']);
  const keys = Object.keys(input || {});
  if (!keys.length || keys.some((k) => !allowed.has(k))) throw new AppError(400, 'INVALID_EVALUATION_UPDATE', 'No hay cambios válidos para aplicar.');
  const clean = sanitizeEvaluationInput(input, true);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(current);
    if (input.slug !== undefined) {
      if (typeof input.slug !== 'string' || !input.slug.trim()) {
        throw new AppError(400, 'INVALID_EVALUATION_SLUG', 'El slug no es válido.');
      }
      const slug = slugify(input.slug);
      if (await repository.slugExists(slug, idEvaluacion, connection)) throw new AppError(409, 'EVALUATION_SLUG_EXISTS', 'Ya existe una evaluación con ese slug.');
      clean.slug = slug;
    }
    await repository.updateEvaluation(connection, idEvaluacion, clean, userId);
    await connection.commit();
    return (await getEvaluation(idEvaluacion)).evaluacion;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

async function deleteEvaluation(idEvaluacion, userId) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const current = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(current);
    await repository.softDeleteEvaluation(connection, idEvaluacion, userId);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

function buildEditorPayload(data, { preview = false } = {}) {
  const mappingsByOption = new Map();
  for (const rel of data.mappings) {
    const key = Number(rel.id_opcion);
    if (!mappingsByOption.has(key)) mappingsByOption.set(key, []);
    mappingsByOption.get(key).push({ id_dimension: Number(rel.id_dimension), valor: Number(rel.valor) });
  }
  const optionsByQuestion = new Map();
  for (const option of data.options) {
    const key = Number(option.id_pregunta);
    if (!optionsByQuestion.has(key)) optionsByQuestion.set(key, []);
    const item = {
      id_opcion: Number(option.id_opcion),
      texto: option.texto,
      orden: Number(option.orden || 0)
    };
    if (!preview) {
      item.es_correcta = Boolean(option.es_correcta);
      item.dimensiones = mappingsByOption.get(Number(option.id_opcion)) || [];
    }
    optionsByQuestion.get(key).push(item);
  }
  const questions = data.questions.map((q) => normalizeQuestion(q, optionsByQuestion.get(Number(q.id_pregunta)) || []));
  if (preview) {
    for (const q of questions) delete q.valor;
  }
  return {
    evaluacion: normalizeEvaluation(data.evaluation),
    version: normalizeVersion(data.version, data.evaluation.id_version_activa),
    dimensiones: preview ? undefined : data.dimensions.map(normalizeDimension),
    preguntas: questions,
    config_presentacion: parseJson(data.version.config_presentacion_json, {})
  };
}

async function getEditor(idEvaluacion, idVersion, preview = false) {
  const data = await repository.getEditorData(idEvaluacion, idVersion);
  if (!data) throw new AppError(404, 'VERSION_NOT_FOUND', 'Evaluación o versión no encontrada.');
  return buildEditorPayload(data, { preview });
}

async function updatePresentation(idEvaluacion, idVersion, config, userId) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new AppError(400, 'INVALID_PRESENTATION_CONFIG', 'La configuración de presentación no es válida.');
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const evaluation = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(evaluation);
    const version = await repository.findVersion(idEvaluacion, idVersion, connection, true);
    assertDraft(version);
    await repository.updateVersionPresentation(connection, idVersion, config, userId);
    await connection.commit();
    return (await getEditor(idEvaluacion, idVersion)).version;
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function normalizeDimensionInput(input, partial = false) {
  const out = {};
  if (!partial || input.codigo !== undefined) {
    const codigo = typeof input.codigo === 'string' ? input.codigo.trim() : '';
    if (!codigo || codigo.length > 60) throw new AppError(400, 'INVALID_DIMENSION_CODE', 'El código de la dimensión no es válido.');
    out.codigo = codigo;
  }
  if (!partial || input.nombre !== undefined) {
    const nombre = typeof input.nombre === 'string' ? input.nombre.trim() : '';
    if (!nombre || nombre.length > 150) throw new AppError(400, 'INVALID_DIMENSION_NAME', 'El nombre de la dimensión no es válido.');
    out.nombre = nombre;
  }
  for (const field of ['descripcion', 'color', 'icono']) {
    if (input[field] !== undefined) out[field] = input[field] === null ? null : String(input[field]).trim();
    else if (!partial) out[field] = null;
  }
  if (input.orden !== undefined) {
    const orden = Number(input.orden);
    if (!Number.isInteger(orden) || orden < 0) throw new AppError(400, 'INVALID_ORDER', 'El orden no es válido.');
    out.orden = orden;
  }
  if (input.configuracion !== undefined) {
    if (input.configuracion !== null && (typeof input.configuracion !== 'object' || Array.isArray(input.configuracion))) throw new AppError(400, 'INVALID_DIMENSION_CONFIG', 'La configuración de dimensión no es válida.');
    out.configuracion_json = input.configuracion;
  }
  return out;
}

async function createDimension(idEvaluacion, idVersion, input) {
  const clean = normalizeDimensionInput(input, false);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    if (await repository.dimensionCodeExists(idVersion, clean.codigo, null, connection)) {
      throw new AppError(409, 'DIMENSION_CODE_EXISTS', 'Ese código de dimensión ya existe en esta versión.');
    }
    if (clean.orden === undefined) clean.orden = (await repository.dimensionIdsForVersion(idVersion, connection)).length + 1;
    const id = await repository.createDimension(connection, idVersion, {
      codigo: clean.codigo, nombre: clean.nombre, descripcion: clean.descripcion,
      color: clean.color, icono: clean.icono, orden: clean.orden,
      configuracion: clean.configuracion_json || null
    });
    await connection.commit();
    return normalizeDimension(await repository.findDimension(idVersion, id));
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') throw new AppError(409, 'DIMENSION_CODE_EXISTS', 'Ese código de dimensión ya existe en esta versión.');
    throw error;
  } finally { connection.release(); }
}

async function updateDimension(idEvaluacion, idVersion, idDimension, input) {
  const allowed = new Set(['codigo', 'nombre', 'descripcion', 'color', 'icono', 'orden', 'configuracion']);
  const keys = Object.keys(input || {});
  if (!keys.length || keys.some((k) => !allowed.has(k))) throw new AppError(400, 'INVALID_DIMENSION_UPDATE', 'No hay cambios válidos para aplicar.');
  const clean = normalizeDimensionInput(input, true);
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    if (!await repository.findDimension(idVersion, idDimension, connection)) throw new AppError(404, 'DIMENSION_NOT_FOUND', 'Dimensión no encontrada.');
    if (clean.codigo !== undefined && await repository.dimensionCodeExists(idVersion, clean.codigo, idDimension, connection)) {
      throw new AppError(409, 'DIMENSION_CODE_EXISTS', 'Ese código de dimensión ya existe en esta versión.');
    }
    await repository.updateDimension(connection, idDimension, clean);
    await connection.commit();
    return normalizeDimension(await repository.findDimension(idVersion, idDimension));
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function deleteDimension(idEvaluacion, idVersion, idDimension) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    if (!await repository.findDimension(idVersion, idDimension, connection)) throw new AppError(404, 'DIMENSION_NOT_FOUND', 'Dimensión no encontrada.');
    await repository.deleteDimension(connection, idDimension);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function assertExactOrder(actualIds, orderedIds, code, message) {
  if (!Array.isArray(orderedIds) || orderedIds.length !== actualIds.length) throw new AppError(400, code, message);
  const a = [...actualIds].sort((x, y) => x - y);
  const b = orderedIds.map(Number).sort((x, y) => x - y);
  if (b.some((id) => !Number.isInteger(id)) || a.some((id, i) => id !== b[i])) throw new AppError(400, code, message);
}

async function reorderDimensions(idEvaluacion, idVersion, orderedIds) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    const actual = await repository.dimensionIdsForVersion(idVersion, connection);
    assertExactOrder(actual, orderedIds, 'INVALID_DIMENSION_ORDER', 'El orden debe incluir exactamente todas las dimensiones de la versión.');
    await repository.reorderDimensions(connection, orderedIds.map(Number));
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function normalizeQuestionInput(input, defaultOrder = 1) {
  const texto = typeof input.texto === 'string' ? input.texto.trim() : '';
  if (!texto || texto.length > 5000) throw new AppError(400, 'INVALID_QUESTION_TEXT', 'El texto de la pregunta no es válido.');
  if (!VALID_QUESTION_TYPES.has(input.tipo)) throw new AppError(400, 'INVALID_QUESTION_TYPE', 'El tipo de pregunta no es válido.');
  const valor = input.valor === undefined ? 1 : Number(input.valor);
  if (!Number.isFinite(valor) || valor < 0) throw new AppError(400, 'INVALID_QUESTION_VALUE', 'El valor de la pregunta no es válido.');
  const orden = input.orden === undefined ? defaultOrder : Number(input.orden);
  if (!Number.isInteger(orden) || orden < 0) throw new AppError(400, 'INVALID_ORDER', 'El orden no es válido.');
  const requerida = input.requerida === undefined ? true : input.requerida;
  if (typeof requerida !== 'boolean') throw new AppError(400, 'INVALID_REQUIRED_FLAG', 'requerida debe ser boolean.');
  const configuracion = input.configuracion === undefined || input.configuracion === null ? {} : input.configuracion;
  if (typeof configuracion !== 'object' || Array.isArray(configuracion)) throw new AppError(400, 'INVALID_QUESTION_CONFIG', 'La configuración de la pregunta no es válida.');
  if (!Array.isArray(input.opciones) || input.opciones.length < 2) throw new AppError(400, 'MIN_OPTIONS_REQUIRED', 'La pregunta necesita al menos 2 opciones.');
  const options = input.opciones.map((o, index) => {
    const optionText = typeof o.texto === 'string' ? o.texto.trim() : '';
    if (!optionText || optionText.length > 2000) throw new AppError(400, 'INVALID_OPTION_TEXT', `La opción ${index + 1} no es válida.`);
    const optionOrder = o.orden === undefined ? index + 1 : Number(o.orden);
    if (!Number.isInteger(optionOrder) || optionOrder < 0) throw new AppError(400, 'INVALID_OPTION_ORDER', 'El orden de una opción no es válido.');
    const relations = o.dimensiones === undefined ? [] : o.dimensiones;
    if (!Array.isArray(relations)) throw new AppError(400, 'INVALID_OPTION_DIMENSIONS', 'Las dimensiones de una opción no son válidas.');
    return {
      texto: optionText,
      es_correcta: Boolean(o.es_correcta),
      orden: optionOrder,
      dimensiones: relations.map((r) => ({ id_dimension: Number(r.id_dimension), valor: r.valor === undefined ? 1 : Number(r.valor) }))
    };
  });
  if (input.tipo === 'multiple_choice') {
    if (configuracion.min_selecciones === undefined) configuracion.min_selecciones = 1;
    if (configuracion.max_selecciones === undefined) configuracion.max_selecciones = null;
  }
  if (input.tipo === 'ranking' && configuracion.valores_posicion === undefined) {
    configuracion.valores_posicion = options.map((_, index) => options.length - index);
  }
  return { texto, tipo: input.tipo, valor, orden, requerida, configuracion, opciones: options };
}

function validateQuestionRules(question, { publishing = true } = {}) {
  const errors = [];
  const options = question.opciones || [];
  const correctCount = options.filter((o) => Boolean(o.es_correcta)).length;
  if (options.length < 2) errors.push({ field: 'opciones', code: 'MIN_OPTIONS_REQUIRED', message: 'La pregunta necesita al menos 2 opciones.' });

  if (question.tipo === 'single_choice') {
    if (Number(question.valor) > 0 && correctCount !== 1) errors.push({ field: 'opciones.es_correcta', code: 'SINGLE_CORRECT_COUNT', message: 'Una pregunta single choice con valor debe tener exactamente una opción correcta.' });
  }

  if (question.tipo === 'multiple_choice') {
    const min = Number(question.configuracion?.min_selecciones ?? 1);
    const maxRaw = question.configuracion?.max_selecciones;
    const max = maxRaw === null || maxRaw === undefined ? null : Number(maxRaw);
    if (!Number.isInteger(min) || min < 1) errors.push({ field: 'configuracion.min_selecciones', code: 'INVALID_MIN_SELECTIONS', message: 'min_selecciones debe ser un entero mayor o igual a 1.' });
    if (max !== null && (!Number.isInteger(max) || max < min || max > options.length)) errors.push({ field: 'configuracion.max_selecciones', code: 'INVALID_MAX_SELECTIONS', message: 'max_selecciones debe ser nulo o estar entre el mínimo y la cantidad de opciones.' });
    if (Number(question.valor) > 0 && correctCount < 1) errors.push({ field: 'opciones.es_correcta', code: 'MULTIPLE_CORRECT_REQUIRED', message: 'Una pregunta multiple choice con valor debe tener al menos una opción correcta.' });
  }

  if (question.tipo === 'ranking') {
    const values = question.configuracion?.valores_posicion;
    if (!Array.isArray(values) || values.length !== options.length || values.some((v) => !Number.isFinite(Number(v)))) {
      errors.push({ field: 'configuracion.valores_posicion', code: 'RANKING_POSITION_COUNT_MISMATCH', message: 'valores_posicion debe contener un valor numérico por cada opción.' });
    }
  }

  if (!publishing && errors.length) {
    const first = errors[0];
    throw new AppError(400, first.code, first.message);
  }
  return errors;
}

async function assertQuestionDimensions(connection, idVersion, question) {
  const valid = new Set((await repository.dimensionIdsForVersion(idVersion, connection)).map(Number));
  for (const option of question.opciones) {
    const seen = new Set();
    for (const relation of option.dimensiones) {
      if (!Number.isInteger(relation.id_dimension) || !valid.has(relation.id_dimension)) throw new AppError(400, 'INVALID_OPTION_DIMENSION', 'Una opción referencia una dimensión que no pertenece a esta versión.');
      if (!Number.isFinite(relation.valor)) throw new AppError(400, 'INVALID_DIMENSION_VALUE', 'El valor dimensional no es válido.');
      if (seen.has(relation.id_dimension)) throw new AppError(400, 'DUPLICATE_OPTION_DIMENSION', 'Una opción no puede repetir la misma dimensión.');
      seen.add(relation.id_dimension);
    }
  }
}

async function writeOptions(connection, idQuestion, options) {
  for (const option of options) {
    const idOption = await repository.insertOption(connection, idQuestion, option);
    for (const relation of option.dimensiones) await repository.insertOptionDimension(connection, idOption, relation);
  }
}

async function createQuestion(idEvaluacion, idVersion, input) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    const currentIds = await repository.questionIdsForVersion(idVersion, connection);
    const question = normalizeQuestionInput(input, currentIds.length + 1);
    await assertQuestionDimensions(connection, idVersion, question);
    const idQuestion = await repository.createQuestion(connection, idVersion, question);
    await writeOptions(connection, idQuestion, question.opciones);
    await connection.commit();
    const editor = await getEditor(idEvaluacion, idVersion);
    return editor.preguntas.find((q) => q.id_pregunta === Number(idQuestion));
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function updateQuestion(idEvaluacion, idVersion, idQuestion, input) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    const existing = await repository.findQuestion(idVersion, idQuestion, connection);
    if (!existing) throw new AppError(404, 'QUESTION_NOT_FOUND', 'Pregunta no encontrada.');
    const question = normalizeQuestionInput(input, Number(existing.orden || 1));
    await assertQuestionDimensions(connection, idVersion, question);
    await repository.updateQuestion(connection, idQuestion, question);
    await repository.deleteQuestionOptions(connection, idQuestion);
    await writeOptions(connection, idQuestion, question.opciones);
    await connection.commit();
    const editor = await getEditor(idEvaluacion, idVersion);
    return editor.preguntas.find((q) => q.id_pregunta === Number(idQuestion));
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function deleteQuestion(idEvaluacion, idVersion, idQuestion) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    if (!await repository.findQuestion(idVersion, idQuestion, connection)) throw new AppError(404, 'QUESTION_NOT_FOUND', 'Pregunta no encontrada.');
    await repository.deleteQuestion(connection, idQuestion);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function reorderQuestions(idEvaluacion, idVersion, orderedIds) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    assertDraft(await repository.findVersion(idEvaluacion, idVersion, connection, true));
    const actual = await repository.questionIdsForVersion(idVersion, connection);
    assertExactOrder(actual, orderedIds, 'INVALID_QUESTION_ORDER', 'El orden debe incluir exactamente todas las preguntas de la versión.');
    await repository.reorderQuestions(connection, orderedIds.map(Number));
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

function validateEditor(editor) {
  const errors = [];
  if (!editor.preguntas.length) errors.push({ type: 'version', field: 'preguntas', code: 'QUESTIONS_REQUIRED', message: 'La versión necesita al menos una pregunta.' });
  const dimensionIds = new Set(editor.dimensiones.map((d) => d.id_dimension));
  for (const q of editor.preguntas) {
    for (const err of validateQuestionRules(q, { publishing: true })) errors.push({ type: 'question', id: q.id_pregunta, ...err });
    for (const option of q.opciones) {
      const seen = new Set();
      for (const rel of option.dimensiones || []) {
        if (!dimensionIds.has(rel.id_dimension)) errors.push({ type: 'question', id: q.id_pregunta, field: 'opciones.dimensiones', code: 'INVALID_OPTION_DIMENSION', message: 'Una opción referencia una dimensión inexistente en la versión.' });
        if (seen.has(rel.id_dimension)) errors.push({ type: 'question', id: q.id_pregunta, field: 'opciones.dimensiones', code: 'DUPLICATE_OPTION_DIMENSION', message: 'Una opción repite la misma dimensión.' });
        seen.add(rel.id_dimension);
      }
    }
  }
  return errors;
}

async function validateVersion(idEvaluacion, idVersion) {
  const editor = await getEditor(idEvaluacion, idVersion);
  const errors = validateEditor(editor);
  return { valid: errors.length === 0, errors };
}

async function publishVersion(idEvaluacion, idVersion, userId) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const evaluation = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(evaluation);
    const version = await repository.findVersion(idEvaluacion, idVersion, connection, true);
    assertDraft(version);

    const data = await repository.getEditorData(idEvaluacion, idVersion, connection);
    const editor = buildEditorPayload(data, { preview: false });
    const errors = validateEditor(editor);
    if (errors.length) {
      const error = new AppError(422, 'EVALUATION_VALIDATION_FAILED', 'La evaluación todavía tiene errores.');
      error.details = errors;
      throw error;
    }

    await repository.markVersionPublished(connection, idVersion, userId);
    await repository.setActiveVersion(connection, idEvaluacion, idVersion, userId);
    await connection.commit();
    return await getEvaluation(idEvaluacion);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function activateVersion(idEvaluacion, idVersion, userId) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const evaluation = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(evaluation);
    const version = await repository.findVersion(idEvaluacion, idVersion, connection, true);
    if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Versión no encontrada.');
    if (version.status !== 'published') throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'Solo una versión publicada puede ser la versión activa.');
    await repository.setActiveVersion(connection, idEvaluacion, idVersion, userId);
    await connection.commit();
    return await getEvaluation(idEvaluacion);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function retireVersion(idEvaluacion, idVersion, userId) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    const evaluation = await repository.findEvaluationById(idEvaluacion, connection, true);
    assertEvaluationActiveRecord(evaluation);
    const version = await repository.findVersion(idEvaluacion, idVersion, connection, true);
    if (!version) throw new AppError(404, 'VERSION_NOT_FOUND', 'Versión no encontrada.');
    if (version.status !== 'published') throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'Solo una versión publicada puede retirarse.');
    if (Number(evaluation.id_version_activa) === Number(idVersion)) throw new AppError(409, 'ACTIVE_VERSION_CANNOT_RETIRE', 'Activa otra versión antes de retirar la versión activa.');
    await repository.markVersionRetired(connection, idVersion, userId);
    await connection.commit();
    return await getEvaluation(idEvaluacion);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

async function duplicateVersion(idEvaluacion, idVersion, userId) {
  const connection = await repository.pool.getConnection();
  try {
    await connection.beginTransaction();
    assertEvaluationActiveRecord(await repository.findEvaluationById(idEvaluacion, connection, true));
    const source = await repository.findVersion(idEvaluacion, idVersion, connection, true);
    if (!source) throw new AppError(404, 'VERSION_NOT_FOUND', 'Versión no encontrada.');
    if (source.status !== 'published') throw new AppError(409, 'VERSION_NOT_PUBLISHED', 'Solo una versión publicada puede duplicarse para editar.');
    const numeroVersion = await repository.nextVersionNumber(connection, idEvaluacion);
    const config = parseJson(source.config_presentacion_json, {});
    const newVersionId = await repository.createVersion(connection, { idEvaluacion, numeroVersion, configPresentacion: config, userId });
    const dimensionMap = await repository.copyDimensions(connection, idVersion, newVersionId);
    await repository.copyQuestions(connection, idVersion, newVersionId, dimensionMap);
    await connection.commit();
    return (await getEvaluation(idEvaluacion)).versiones.find((v) => v.id_evaluacion_version === Number(newVersionId));
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

module.exports = {
  listEvaluations,
  getEvaluation,
  createEvaluation,
  updateEvaluation,
  deleteEvaluation,
  getEditor,
  updatePresentation,
  createDimension,
  updateDimension,
  deleteDimension,
  reorderDimensions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  validateVersion,
  publishVersion,
  activateVersion,
  retireVersion,
  duplicateVersion
};
