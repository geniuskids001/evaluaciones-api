const express = require('express');
const controller = require('./trash.controller');
const { authenticate } = require('../../middleware/auth.middleware');
const { capabilitiesFor } = require('../auth/auth.permissions');
const { AppError } = require('../../utils/app-error');

const router = express.Router();

router.use(authenticate);
router.use((req, res, next) => {
  const caps = capabilitiesFor(req.user?.rol);
  if (!caps.includes('papelera:manage:any') && !caps.includes('papelera:manage:own')) {
    return next(new AppError(403, 'FORBIDDEN', 'No tienes acceso a la papelera.'));
  }
  return next();
});

router.get('/', controller.list);

router.post('/evaluaciones/:id/restaurar', controller.restoreEvaluation);
router.post('/evaluaciones/:id/eliminar-definitivamente', controller.purgeEvaluation);

router.post('/versiones/:id/restaurar', controller.restoreVersion);
router.post('/versiones/:id/eliminar-definitivamente', controller.purgeVersion);

router.post('/sesiones/:id/restaurar', controller.restoreSession);
router.post('/sesiones/:id/eliminar-definitivamente', controller.purgeSession);

module.exports = router;
