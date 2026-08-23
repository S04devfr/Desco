/**
 * Enterprise Activity & Operator Presence API Router
 */
const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');
const { recordHeartbeat, getLiveOperatorPresence } = require('../services/activityService');
const { apiSuccess, apiError } = require('../utils/response');

router.use(protect);

/**
 * @route POST /api/activity/ping
 * @desc Heartbeat ping from client (active / idle status)
 */
router.post('/ping', async (req, res) => {
  try {
    const userId = req.userId || req.session?.userId || req.user?.id;
    const { isIdle = false, action = null } = req.body || {};
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    const device = req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 255) : null;
    const broadcast = req.app.get('broadcast');

    const session = await recordHeartbeat({
      userId,
      isIdle: Boolean(isIdle),
      action,
      ipAddress,
      device,
      broadcast
    });

    return apiSuccess(res, { ok: true, status: session?.status || 'active', ts: new Date().toISOString() });
  } catch (err) {
    console.error('[Activity Ping Error]', err.message);
    return apiSuccess(res, { ok: false }); // Always return 200 to not block client execution
  }
});

/**
 * @route GET /api/activity/presence
 * @desc Live real-time operator presence list (Admin, Manager, Operator)
 */
router.get('/presence', async (req, res) => {
  try {
    const data = await getLiveOperatorPresence();
    return apiSuccess(res, data);
  } catch (err) {
    return apiError(res, err.message, 500);
  }
});

/**
 * @route GET /api/activity/online
 * @desc Quick list of currently active user IDs
 */
router.get('/online', async (req, res) => {
  try {
    const data = await getLiveOperatorPresence();
    const onlineUsers = data.operators.filter(o => o.status === 'active' || o.status === 'idle');
    return apiSuccess(res, onlineUsers);
  } catch (err) {
    return apiSuccess(res, []);
  }
});

/**
 * @route GET /api/activity/stats
 * @desc Admin operator presence stats
 */
router.get('/stats', requireRole('admin'), async (req, res) => {
  try {
    const data = await getLiveOperatorPresence();
    return apiSuccess(res, data);
  } catch (err) {
    return apiError(res, err.message, 500);
  }
});

module.exports = router;
