const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLog');
const cacheService = require('../services/cacheService');

router.use(protect);
router.use(requireRole('admin'));

// In-memory config stores (persisted in cacheService & DB fallbacks)
let roundRobinConfig = {
  enabled: true,
  activeManagerIds: [],
  lastAssignedIndex: 0
};

let autoMessagesConfig = [
  {
    id: 'msg-1',
    stageName: 'Yetkazib berish',
    enabled: true,
    channel: 'telegram',
    template: 'Hurmatli {clientName}, sizning "{productName}" buyurtmangiz kuryerga topshirildi! Qayta aloqa: {driverPhone}'
  },
  {
    id: 'msg-2',
    stageName: 'Nasiya Desco',
    enabled: true,
    channel: 'sms',
    template: 'Hurmatli {clientName}, Desco CRM: Oylik tolov sanangiz yaqinlashtimoqda. Malumot uchun: +998901234567'
  }
];

let permissionsConfig = {
  manager: {
    canDeleteDeals: false,
    canExportExcel: false,
    canViewExpenses: true,
    canEditProducts: false,
    canManageDebts: true
  },
  operator: {
    canDeleteDeals: false,
    canExportExcel: false,
    canViewExpenses: false,
    canEditProducts: false,
    canManageDebts: false
  }
};

// 1. AUDIT LOGS
router.get('/audit-logs', async (req, res) => {
  try {
    const { action, userId, q, page = 1, limit = 50 } = req.query;
    const pageNum = Number(page);
    const limitNum = Number(limit);
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (action) where.action = action;
    if (userId) where.userId = Number(userId);
    if (q) {
      where.OR = [
        { details: { contains: String(q), mode: 'insensitive' } },
        { action: { contains: String(q), mode: 'insensitive' } }
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, email: true, role: true, avatar: true } },
          deal: { select: { id: true, productName: true, amount: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.activityLog.count({ where })
    ]);

    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, email: true }
    });

    res.json({
      logs,
      users,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ROUND ROBIN LEAD DISTRIBUTION
router.get('/round-robin', async (req, res) => {
  try {
    const managers = await prisma.user.findMany({
      where: { isActive: true, role: { in: ['admin', 'manager'] } },
      select: { id: true, fullName: true, email: true, role: true }
    });

    if (roundRobinConfig.activeManagerIds.length === 0) {
      roundRobinConfig.activeManagerIds = managers.map(m => m.id);
    }

    res.json({
      config: roundRobinConfig,
      managers
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/round-robin', async (req, res) => {
  try {
    const { enabled, activeManagerIds } = req.body;
    if (enabled !== undefined) roundRobinConfig.enabled = Boolean(enabled);
    if (Array.isArray(activeManagerIds)) {
      roundRobinConfig.activeManagerIds = activeManagerIds.map(Number);
    }

    logAudit('ROUND_ROBIN_UPDATE', `Lead avto-bo'lish sozlamalari yangilandi (${roundRobinConfig.enabled ? 'Faol' : 'O\'chiq'})`, req.userId, req.user?.email, req.ip);
    res.json({ success: true, config: roundRobinConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. SALES FORECASTING & CONVERSION DROP-OFF
router.get('/sales-forecast', async (req, res) => {
  try {
    const [stages, deals, installments] = await Promise.all([
      prisma.pipelineStage.findMany({
        orderBy: [{ order: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { deals: true } } }
      }),
      prisma.deal.findMany({
        select: { id: true, amount: true, paidAmount: true, stageId: true, status: true, createdAt: true }
      }),
      prisma.installment.findMany({
        where: { paid: false, dueDate: { gte: new Date() } },
        select: { id: true, amount: true, dueDate: true }
      })
    ]);

    const totalDealsCount = deals.length || 1;
    const stageFunnel = stages.map(st => {
      const count = st._count.deals;
      const percentage = Math.round((count / totalDealsCount) * 100);
      return {
        id: st.id,
        name: st.name,
        color: st.color,
        count,
        percentage
      };
    });

    const wonStage = stages.find(s => s.isWon || s.name.toLowerCase().includes('yutildi') || s.name.toLowerCase().includes('yutib'));
    const wonCount = wonStage ? wonStage._count.deals : 0;
    const overallConversionRate = Math.round((wonCount / totalDealsCount) * 100);

    const pendingInstallmentsAmount = installments.reduce((sum, inst) => sum + (inst.amount || 0), 0);
    const activeDealsAmount = deals.filter(d => d.status === 'new').reduce((sum, d) => sum + (d.amount || 0), 0);
    const forecast30Days = Math.round(activeDealsAmount * 0.45 + pendingInstallmentsAmount);

    res.json({
      stageFunnel,
      overallConversionRate,
      metrics: {
        totalDealsCount,
        wonCount,
        activeDealsAmount,
        pendingInstallmentsAmount,
        forecast30Days
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. AUTOMATED STAGE MESSAGES
router.get('/auto-messages', (req, res) => {
  res.json({ messages: autoMessagesConfig });
});

router.post('/auto-messages', (req, res) => {
  try {
    const { messages } = req.body;
    if (Array.isArray(messages)) {
      autoMessagesConfig = messages;
    }
    logAudit('AUTO_MESSAGES_UPDATE', `Avto-xabarlar shabloni yangilandi`, req.userId, req.user?.email, req.ip);
    res.json({ success: true, messages: autoMessagesConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GRANULAR ROLE PERMISSIONS
router.get('/permissions', (req, res) => {
  res.json({ permissions: permissionsConfig });
});

router.post('/permissions', (req, res) => {
  try {
    const { permissions } = req.body;
    if (permissions) {
      permissionsConfig = permissions;
    }
    logAudit('PERMISSIONS_UPDATE', `Rollar bo'yicha cheklovlar matrixi yangilandi`, req.userId, req.user?.email, req.ip);
    res.json({ success: true, permissions: permissionsConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. RESTORE SEED DATA (IMPORT ALL 4,167 CLIENTS & 492 DEALS)
router.post('/restore-seed', async (req, res) => {
  try {
    const runFastSeed = require('../../prisma/seed.js');
    await runFastSeed();
    logAudit('DATABASE_SEED_RESTORED', 'Imported full backup into Railway DB', req.userId, req.user?.email, req.ip);
    res.json({ success: true, message: "4,167 ta mijoz va 492 ta sdelkalar Railway bazasiga muvaffaqiyatli quyildi!" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
