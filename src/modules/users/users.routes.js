const express = require('express');
const controller = require('./users.controller');
const { authenticate, authorizeCapability } = require('../../middleware/auth.middleware');

const router = express.Router();

router.use(authenticate);
router.use(authorizeCapability('usuarios:manage'));

router.get('/', controller.list);
router.post('/', controller.create);
router.get('/:id', controller.get);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/resend-activation', controller.resendActivation);

module.exports = router;
