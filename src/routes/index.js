const express = require('express');
const router = express.Router();
const v1Routes = require('./v1');
const authRoutes = require('./auth/google');
const simulationRoutes = require('./simulations');

router.use('/v1', v1Routes);
router.use('/auth', authRoutes);
router.use('/simulate', simulationRoutes);

module.exports = router;