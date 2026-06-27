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
        stage: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(deals);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
