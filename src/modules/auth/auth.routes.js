const express = require('express');
const controller = require('./auth.controller');
const { authenticate } = require('../../middleware/auth.middleware');

const router = express.Router();

router.post('/login', controller.login);
router.post('/forgot-password', controller.forgotPassword);
router.post('/activate', controller.activate);
router.post('/reset-password', controller.resetPassword);
router.get('/me', authenticate, controller.me);

module.exports = router;
