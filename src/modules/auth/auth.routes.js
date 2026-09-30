const express = require('express');
const controller = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/login', controller.login);
router.post('/forgot-password', controller.forgotPassword);
router.post('/activate', controller.activate);
router.post('/reset-password', controller.resetPassword);
router.post('/change-email/request', authenticate, controller.requestEmailChange);
router.post('/change-email/confirm', controller.confirmEmailChange);
router.post('/change-password/request', authenticate, controller.requestPasswordChange);
router.get('/me', authenticate, controller.me);
router.patch('/me', authenticate, controller.updateMyProfile);

module.exports = router;
