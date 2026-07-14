const express = require('express');
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.use(protect);

// GET /api/nasiya/list-deals?stage=...
router.get('/list-deals', async (req, res, next) => {
  try {
    const { stage } = req.query;
    if (!stage) return res.status(400).json({ message: 'Stage parametru majburiy' });

    // SQLite case-insensitive uchun LOWER() orqali qidiramiz
    const allStages = await prisma.pipelineStage.findMany({ select: { id: true, name: true } });
    const stageLow = stage.toLowerCase();
    const stages = allStages.filter(s => s.name.toLowerCase().includes(stageLow));

    const stageIds = stages.map(s => s.id);

    const deals = await prisma.deal.findMany({
      where: {
        stageId: { in: stageIds }
      },
      include: {
        client: true,
        manager: { select: { id: true, fullName: true, email: true } },
        stage: true,
        installments: { orderBy: { dueDate: 'asc' } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(deals);
  } catch (error) {
    console.error('Nasiya API xatosi:', error);
    return res.status(500).json([]);
  }
});

// POST /api/nasiya/quick-add
router.post('/quick-add', async (req, res, next) => {
  try {
    const { stage, clientName, clientPhone, productName, amount } = req.body;

    // Input validatsiya
    if (!stage || typeof stage !== 'string') return res.status(400).json({ message: 'Bosqich (stage) majburiy' });
    if (!clientName || !clientName.trim()) return res.status(400).json({ message: 'Mijoz ismi majburiy' });
    if (!clientPhone || !clientPhone.trim()) return res.status(400).json({ message: 'Mijoz telefoni majburiy' });

    // Find the stage
    const allSt = await prisma.pipelineStage.findMany({ select: { id: true, name: true, pipelineId: true } });
    const stageRecord = allSt.find(s => s.name.toLowerCase().includes(stage.toLowerCase()));
    
    if (!stageRecord) return res.status(400).json({ message: "Bosqich topilmadi" });

    // Find or create client
    let client = await prisma.client.findFirst({ where: { phone: clientPhone } });
    if (!client) {
      client = await prisma.client.create({
        data: { name: clientName, phone: clientPhone }
      });
    }

    // Create deal
    const deal = await prisma.deal.create({
      data: {
        productName: productName || 'Nasiya',
        amount: Number(amount) || 0,
        status: 'new',
        clientId: client.id,
        stageId: stageRecord.id,
        pipelineId: stageRecord.pipelineId,
        managerId: typeof req.userId === 'number' ? req.userId : null
      }
    });

    res.json(deal);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
