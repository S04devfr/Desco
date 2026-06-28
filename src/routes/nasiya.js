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

    // Map stages that contain key terms
    // E.g. "shopir" matches "Shopirdagi pul"
    const stages = await prisma.pipelineStage.findMany({
      where: {
        name: {
          contains: stage,
          mode: 'insensitive'
        }
      },
      select: { id: true }
    });

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
    
    // Find the stage
    const stageRecord = await prisma.pipelineStage.findFirst({
      where: { name: { contains: stage, mode: 'insensitive' } }
    });
    
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
        pipelineId: stageRecord.pipelineId
      }
    });

    res.json(deal);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
