const express = require('express');
const controller = require('./evaluations.controller');
const { authenticate, authorizeCapability } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);
router.use(authorizeCapability('evaluaciones:manage'));

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

router.get('/:id/versiones/:versionId/editor', controller.editor);
router.get('/:id/versiones/:versionId/preview', controller.preview);
router.patch('/:id/versiones/:versionId/presentacion', controller.updatePresentation);
router.post('/:id/versiones/:versionId/validar', controller.validateVersion);
router.post('/:id/versiones/:versionId/publicar', controller.publish);
router.post('/:id/versiones/:versionId/activar', controller.activate);
router.post('/:id/versiones/:versionId/retirar', controller.retire);
router.post('/:id/versiones/:versionId/duplicar', controller.duplicate);

router.post('/:id/versiones/:versionId/dimensiones', controller.createDimension);
router.patch('/:id/versiones/:versionId/dimensiones/orden', controller.reorderDimensions);
router.patch('/:id/versiones/:versionId/dimensiones/:dimensionId', controller.updateDimension);
router.delete('/:id/versiones/:versionId/dimensiones/:dimensionId', controller.deleteDimension);

router.post('/:id/versiones/:versionId/preguntas', controller.createQuestion);
router.patch('/:id/versiones/:versionId/preguntas/orden', controller.reorderQuestions);
router.put('/:id/versiones/:versionId/preguntas/:questionId', controller.updateQuestion);
router.patch('/:id/versiones/:versionId/preguntas/:questionId', controller.updateQuestion);
router.delete('/:id/versiones/:versionId/preguntas/:questionId', controller.deleteQuestion);

module.exports = router;
