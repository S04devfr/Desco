const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');
const { authorize } = require('../middleware/rbac');
const { PLANS, getTenantUsage } = require('../services/billingService');
const { apiSuccess, apiError } = require('../utils/response');

/**
 * @route GET /api/billing/plans
 * @desc Get all available plans
 */
router.get('/plans', (req, res) => {
  return apiSuccess(res, Object.values(PLANS));
});

/**
 * @route GET /api/billing/current
 * @desc Get current tenant plan & resource usage metrics
 */
router.get('/current', protect, async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.user?.tenantId || 1;
    const usage = await getTenantUsage(tenantId);
    return apiSuccess(res, usage);
  } catch (err) {
    return apiError(res, err.message, 500);
  }
});

/**
 * @route POST /api/billing/change-plan
 * @desc Change tenant plan (Admin only)
 */
router.post('/change-plan', protect, authorize('admin'), async (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId || !PLANS[planId]) {
      return apiError(res, 'Noto\'g\'ri tarif rejasi tanlandi.', 400);
    }

    const tenantId = req.tenant?.id || req.user?.tenantId || 1;

    let tenant = await prisma.tenant?.findFirst({ where: { id: tenantId } }).catch(() => null);

    if (tenant) {
      tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          plan: planId,
          maxUsers: PLANS[planId].limits.maxUsers,
          maxDeals: PLANS[planId].limits.maxDeals
        }
      });
    }

    return apiSuccess(res, {
      message: `Tarif rejasi muvaffaqiyatli o'zgartirildi: ${PLANS[planId].name}`,
      plan: PLANS[planId]
    });
  } catch (err) {
    return apiError(res, err.message, 500);
  }
});

module.exports = router;
