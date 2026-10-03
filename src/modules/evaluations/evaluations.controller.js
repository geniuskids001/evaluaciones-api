const service = require('./evaluations.service');
const { AppError } = require('../../utils/app-error');

function parseId(value, code = 'INVALID_ID') {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, code, 'El identificador no es válido.');
  return id;
}

function ids(req) {
  return {
    idEvaluacion: parseId(req.params.id, 'INVALID_EVALUATION_ID'),
    idVersion: req.params.versionId ? parseId(req.params.versionId, 'INVALID_VERSION_ID') : null
  };
}

async function list(req, res, next) {
  try { res.json({ ok: true, data: { evaluaciones: await service.listEvaluations(req.query.search || '') } }); }
  catch (error) { next(error); }
}

async function get(req, res, next) {
  try { res.json({ ok: true, data: await service.getEvaluation(parseId(req.params.id, 'INVALID_EVALUATION_ID')) }); }
  catch (error) { next(error); }
}

async function create(req, res, next) {
  try { res.status(201).json({ ok: true, data: await service.createEvaluation(req.body || {}, req.user.id_usuario) }); }
  catch (error) { next(error); }
}

async function update(req, res, next) {
  try { res.json({ ok: true, data: { evaluacion: await service.updateEvaluation(parseId(req.params.id, 'INVALID_EVALUATION_ID'), req.body || {}, req.user.id_usuario) } }); }
  catch (error) { next(error); }
}

async function remove(req, res, next) {
  try { await service.deleteEvaluation(parseId(req.params.id, 'INVALID_EVALUATION_ID'), req.user.id_usuario); res.status(204).send(); }
  catch (error) { next(error); }
}

async function removeVersion(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    await service.deleteVersion(idEvaluacion, idVersion, req.user.id_usuario);
    res.status(204).send();
  } catch (error) { next(error); }
}

async function editor(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.getEditor(idEvaluacion, idVersion, false) }); }
  catch (error) { next(error); }
}

async function preview(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.getEditor(idEvaluacion, idVersion, true) }); }
  catch (error) { next(error); }
}

async function updatePresentation(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    const config = req.body?.config_presentacion;
    res.json({ ok: true, data: { version: await service.updatePresentation(idEvaluacion, idVersion, config, req.user.id_usuario) } });
  } catch (error) { next(error); }
}

async function createDimension(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.status(201).json({ ok: true, data: { dimension: await service.createDimension(idEvaluacion, idVersion, req.body || {}) } }); }
  catch (error) { next(error); }
}

async function updateDimension(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    const idDimension = parseId(req.params.dimensionId, 'INVALID_DIMENSION_ID');
    res.json({ ok: true, data: { dimension: await service.updateDimension(idEvaluacion, idVersion, idDimension, req.body || {}) } });
  } catch (error) { next(error); }
}

async function deleteDimension(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    await service.deleteDimension(idEvaluacion, idVersion, parseId(req.params.dimensionId, 'INVALID_DIMENSION_ID'));
    res.status(204).send();
  } catch (error) { next(error); }
}

async function reorderDimensions(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); await service.reorderDimensions(idEvaluacion, idVersion, req.body?.orden); res.json({ ok: true, data: { updated: true } }); }
  catch (error) { next(error); }
}

async function createQuestion(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.status(201).json({ ok: true, data: { pregunta: await service.createQuestion(idEvaluacion, idVersion, req.body || {}) } }); }
  catch (error) { next(error); }
}

async function updateQuestion(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    const idQuestion = parseId(req.params.questionId, 'INVALID_QUESTION_ID');
    res.json({ ok: true, data: { pregunta: await service.updateQuestion(idEvaluacion, idVersion, idQuestion, req.body || {}) } });
  } catch (error) { next(error); }
}

async function deleteQuestion(req, res, next) {
  try {
    const { idEvaluacion, idVersion } = ids(req);
    await service.deleteQuestion(idEvaluacion, idVersion, parseId(req.params.questionId, 'INVALID_QUESTION_ID'));
    res.status(204).send();
  } catch (error) { next(error); }
}

async function reorderQuestions(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); await service.reorderQuestions(idEvaluacion, idVersion, req.body?.orden); res.json({ ok: true, data: { updated: true } }); }
  catch (error) { next(error); }
}

async function validateVersion(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.validateVersion(idEvaluacion, idVersion) }); }
  catch (error) { next(error); }
}

async function publish(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.publishVersion(idEvaluacion, idVersion, req.user.id_usuario) }); }
  catch (error) { next(error); }
}

async function activate(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.activateVersion(idEvaluacion, idVersion, req.user.id_usuario) }); }
  catch (error) { next(error); }
}

async function retire(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.json({ ok: true, data: await service.retireVersion(idEvaluacion, idVersion, req.user.id_usuario) }); }
  catch (error) { next(error); }
}

async function duplicate(req, res, next) {
  try { const { idEvaluacion, idVersion } = ids(req); res.status(201).json({ ok: true, data: { version: await service.duplicateVersion(idEvaluacion, idVersion, req.user.id_usuario) } }); }
  catch (error) { next(error); }
}

module.exports = {
  list, get, create, update, remove, removeVersion,
  editor, preview, updatePresentation,
  createDimension, updateDimension, deleteDimension, reorderDimensions,
  createQuestion, updateQuestion, deleteQuestion, reorderQuestions,
  validateVersion, publish, activate, retire, duplicate
};
