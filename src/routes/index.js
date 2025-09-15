const express = require('express');
const router = express.Router();
const v1Routes = require('./v1');
const authRoutes = require('./auth/google');

router.use('/v1', v1Routes);
router.use('/auth', authRoutes);

module.exports = router; 