const express = require('express');
const controller = require('./sessions.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { capabilitiesFor } = require('../auth/auth.permissions');
const { AppError } = require('../../utils/app-error');
const { verifyCloudTaskRequest } = require('./email-queue.service');

const router = express.Router();

// Público / participante. En navegador se recomienda Authorization: Bearer <access_token>.
// También se acepta X-Application-Token cuando el cliente pueda enviarlo.
router.get('/reporte/:token', controller.publicReport);
router.post('/tasks/email', verifyCloudTaskRequest, controller.emailTask);
router.get('/join/:codigo', controller.joinInfo);
router.post('/join/:codigo', controller.join);
router.get('/participacion/estado', controller.participantState);
router.post('/participacion/iniciar', controller.participantStart);
router.get('/participacion/pregunta', controller.participantQuestion);
router.put('/participacion/respuestas/:questionId', controller.participantAnswer);
router.post('/participacion/finalizar', controller.participantFinish);
router.get('/participacion/resultados', controller.participantResults);
router.post('/participacion/reiniciar', controller.participantRestart);
router.post('/participacion/resultados/email', controller.participantEmail);

function authorizeSessionManager(req, res, next) {
  const capabilities = capabilitiesFor(req.user?.rol);
  if (!capabilities.includes('sesiones:manage:any') && !capabilities.includes('sesiones:manage:own')) {
    return next(new AppError(403, 'FORBIDDEN', 'No tienes permiso para administrar sesiones.'));
  }
  return next();
}

router.use(authenticate);
router.use(authorizeSessionManager);

router.get('/opciones-evaluaciones', controller.evaluationOptions);
router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id/live', controller.live);
router.get('/:id/resultados', controller.results);
router.get('/:id/aplicaciones/:applicationId/resultados', controller.applicationResult);
router.get('/:id/envios', controller.emailHistory);
router.post('/:id/envios/:sendId/reintentar', controller.retryEmail);
router.post('/:id/aplicaciones/:applicationId/email', controller.adminSendEmail);
router.patch('/:id/controles', controller.controls);
router.post('/:id/cerrar', controller.close);
router.post('/:id/reabrir', controller.reopen);
router.post('/:id/guiada/navegar', controller.navigate);
router.post('/:id/guiada/finalizar', controller.finalizeGuided);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);

module.exports = router;
