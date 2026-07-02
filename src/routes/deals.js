const express = require('express')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const managerSelect = { select: { id: true, fullName: true, email: true, role: true } }
const stageSelect = { select: { id: true, name: true, color: true, order: true } }

async function logActivity(dealId, userId, action, details) {
  try {
    await prisma.activityLog.create({ data: { action, details, dealId, userId } })
  } catch (e) { /* ignore */ }
}

// List deals
router.get('/', async (req, res, next) => {
  try {
    const { status, managerId, clientId, stageId, pipelineId, q } = req.query
    const where = {}
    if (status) where.status = status
    if (managerId) where.managerId = Number(managerId)
    if (clientId) where.clientId = Number(clientId)
    if (stageId) where.stageId = Number(stageId)

    // pipelineId filter: find stageIds belonging to that pipeline
    if (pipelineId) {
      try {
        const stageRows = await prisma.pipelineStage.findMany({
          where: { pipelineId: Number(pipelineId) },
          select: { id: true }
        })
        where.stageId = { in: stageRows.map(r => r.id) }
      } catch(e) { /* ignore, show all */ }
    }

    // Admin va Manager barcha sdelkalarni ko'ra oladi, Operator ham (lekin o'zgartira olmaydi)

    let deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true } },
        manager: managerSelect,
        stage: stageSelect
      },
      orderBy: { createdAt: 'desc' }
    })

    if (q) deals = deals.filter(d => d.productName?.toLowerCase().includes(q.toLowerCase()))
    res.json(deals)
  } catch (error) { next(error) }
})

// Get deal details
router.get('/:id', async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true } },
        manager: managerSelect,
        stage: stageSelect,
        tasks: true,
        activities: {
          include: { user: managerSelect },
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    })
    if (!deal) return res.status(404).json({ message: 'Sdelka topilmadi' })
    if (!deal.managerId) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { managerId: req.userId }
      });
      deal.managerId = req.userId;
      const broadcast = req.app.get('broadcast');
      if (broadcast) broadcast({ type: 'deal_updated', dealId: deal.id, managerId: req.userId });
    }

    if (!deal.activities) deal.activities = []
    res.json(deal)
  } catch (error) { next(error) }
})

// Create deal.
// Supports two input shapes:
//  1) classic — clientId pointing at an existing Client
//  2) "Быстрое добавление" quick-add — inline contact/company fields
//     (contactName, contactPhone, contactEmail, companyName, companyAddress).
//     When clientId is absent but any of those are provided, a new Client
//     row is auto-created first and the deal is linked to it.
router.post('/', async (req, res, next) => {
  try {
    const {
      productName, amount, paidAmount, status, notes, clientId, deadline, stageId, pipelineId,
      contactName, contactPhone, contactEmail, companyName, companyAddress, city, costPrice
    } = req.body
    if (!productName) return res.status(400).json({ message: 'Mahsulot nomi majburiy' })

    let resolvedClientId = clientId ? Number(clientId) : null

    if (!resolvedClientId) {
      const hasQuickAddFields = [contactName, contactPhone, contactEmail, companyName, companyAddress, city]
        .some(v => v !== undefined && v !== null && String(v).trim() !== '')

      if (hasQuickAddFields) {
        const newClient = await prisma.client.create({
          data: {
            name: (contactName && contactName.trim()) || (companyName && companyName.trim()) || "Noma'lum mijoz",
            phone: contactPhone || null,
            city: city || null,
            email: contactEmail || null,
            company: companyName || null,
            companyAddress: companyAddress || null,
            ownerId: req.userId
          }
        })
        resolvedClientId = newClient.id
      }
    }

    const deal = await prisma.deal.create({
      data: {
        productName,
        amount: amount ? Number(amount) : 0,
        paidAmount: paidAmount ? Number(paidAmount) : 0,
        costPrice: costPrice ? Number(costPrice) : 0,
        status: status || 'new',
        notes: notes || null,
        deadline: (deadline && !isNaN(new Date(deadline))) ? new Date(deadline) : null,
        clientId: resolvedClientId,
        managerId: req.userId,
        stageId: stageId ? Number(stageId) : null,
        pipelineId: pipelineId ? Number(pipelineId) : null
      },
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true } },
        manager: managerSelect,
        stage: stageSelect
      }
    })

    await logActivity(deal.id, req.userId, 'Sdelka yaratildi', `"${deal.productName}" sdelkasi yaratildi`)
    
    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_updated', dealId: deal.id });
    
    res.status(201).json(deal)
  } catch (error) { next(error) }
})

// Claim a deal
router.post('/:id/claim', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.deal.findUnique({ where: { id: Number(req.params.id) }, include: { stage: true } })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    // Only allow claiming if it has no manager OR it's in a stage named "Yangi"
    const isNewStage = existing.stage && existing.stage.name.toLowerCase().includes('yangi')
    if (existing.managerId === null || isNewStage) {
      const updated = await prisma.deal.update({
        where: { id: Number(req.params.id) },
        data: { managerId: req.userId }
      })
      await logActivity(updated.id, req.userId, 'Sdelka o\'zlashtirildi', `Sdelka menejerga biriktirildi`)
      return res.json(updated)
    }

    return res.status(400).json({ message: 'Bu sdelka allaqachon boshqa menejerga tegishli' })
  } catch (error) { next(error) }
})

// Update deal
router.patch('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { productName, amount, paidAmount, status, notes, clientId, deadline, managerId, stageId, costPrice } = req.body

    const existing = await prisma.deal.findUnique({ where: { id: Number(req.params.id) } })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    const data = {}
    if (productName !== undefined) data.productName = productName
    if (amount !== undefined) data.amount = Number(amount)
    if (paidAmount !== undefined) data.paidAmount = Number(paidAmount)
    if (costPrice !== undefined) data.costPrice = Number(costPrice) || 0
    if (status !== undefined) data.status = status
    if (notes !== undefined) data.notes = notes
    if (clientId !== undefined) data.clientId = clientId ? Number(clientId) : null
    if (deadline !== undefined) data.deadline = (deadline && !isNaN(new Date(deadline))) ? new Date(deadline) : null
    if (managerId !== undefined) data.managerId = managerId ? Number(managerId) : null
    if (stageId !== undefined) data.stageId = stageId ? Number(stageId) : null

    const deal = await prisma.deal.update({
      where: { id: Number(req.params.id) },
      data,
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true } },
        manager: managerSelect,
        stage: stageSelect
      }
    })

    const statusLabels = { new: 'Yangi', negotiation: 'Muzokaralar', proposal: 'Taklif', won: 'Yutilgan', lost: "Yo'qotilgan" }
    if (status && status !== existing.status) {
      await logActivity(deal.id, req.userId, "Status o'zgartirildi",
        `${statusLabels[existing.status] || existing.status} → ${statusLabels[status] || status}`)
    } else if (Object.keys(data).length > 0) {
      await logActivity(deal.id, req.userId, 'Sdelka yangilandi', Object.keys(data).join(', ') + " o'zgartirildi")
    }

    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_updated', dealId: deal.id });

    res.json(deal)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka topilmadi' })
    next(error)
  }
})

// Move deal to another stage (dedicated endpoint for Kanban drag-and-drop).
// Strict validation + atomic transaction: if the activity-log write fails,
// the stage change is rolled back automatically by Prisma's $transaction —
// the deal never ends up "half moved".
router.patch('/:id/stage', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Noto'g'ri sdelka ID" })
    }

    const { stageId } = req.body
    let newStageId = null
    if (stageId !== null && stageId !== undefined && stageId !== '') {
      newStageId = Number(stageId)
      if (!Number.isInteger(newStageId) || newStageId <= 0) {
        return res.status(400).json({ message: "Noto'g'ri bosqich ID" })
      }
    }

    const existing = await prisma.deal.findUnique({
      where: { id },
      include: { stage: stageSelect }
    })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    let newStage = null
    if (newStageId !== null) {
      newStage = await prisma.pipelineStage.findUnique({ where: { id: newStageId } })
      if (!newStage) return res.status(400).json({ message: 'Bosqich topilmadi' })
    }

    // No-op: already in the requested stage — return as-is, nothing to roll back.
    if (existing.stageId === newStageId) {
      const unchanged = await prisma.deal.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true } },
          manager: managerSelect,
          stage: stageSelect
        }
      })
      return res.json(unchanged)
    }

    const deal = await prisma.$transaction(async (tx) => {
      let finalStageId = newStageId;
      let finalPipelineId = existing.pipelineId;
      
      // Automation: Nasiya
      if (newStage && newStage.name.toLowerCase().includes('nasiya')) {
        const nasiyaPipeline = await tx.pipeline.findFirst({
          where: { name: { contains: 'nasiya', mode: 'insensitive' } },
          include: { stages: { orderBy: { order: 'asc' } } }
        });
        if (nasiyaPipeline && nasiyaPipeline.stages.length > 0 && nasiyaPipeline.id !== existing.pipelineId) {
          finalStageId = nasiyaPipeline.stages[0].id;
          finalPipelineId = nasiyaPipeline.id;
        }
      }

      let finalManagerId = existing.managerId;
      if (!finalManagerId) {
        finalManagerId = req.userId;
      }

      const updated = await tx.deal.update({
        where: { id },
        data: { stageId: finalStageId, pipelineId: finalPipelineId, managerId: finalManagerId },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true } },
          manager: managerSelect,
          stage: stageSelect
        }
      })
      await tx.activityLog.create({
        data: {
          action: "Bosqich o'zgartirildi",
          details: `${existing.stage?.name || 'Bosqichsiz'} → ${updated.stage?.name || 'Bosqichsiz'}`,
          dealId: id,
          userId: req.userId
        }
      })

      // Automation: Qayta aloqa
      if (updated.stage && updated.stage.name.toLowerCase().includes('qayta aloqa')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await tx.task.create({
          data: {
            title: (existing.productName || 'Sdelka') + " bo'yicha qayta aloqa",
            description: "Avtomatik yaratilgan vazifa: Mijoz bilan qayta aloqaga chiqish",
            dueDate: tomorrow,
            dealId: id,
            assignedToId: req.userId
          }
        });
      }

      const broadcast = req.app.get('broadcast');
      if (broadcast) broadcast({ type: 'deal_updated', dealId: updated.id });

      return updated
    })

    res.json(deal)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka yoki bosqich topilmadi' })
    next(error)
  }
})

// Delete deal
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await prisma.task.deleteMany({ where: { dealId: Number(req.params.id) } })
    await prisma.activityLog.deleteMany({ where: { dealId: Number(req.params.id) } })
    await prisma.deal.delete({ where: { id: Number(req.params.id) } })
    
    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_deleted', dealId: Number(req.params.id) });
    
    res.json({ message: "Sdelka o'chirildi" })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka topilmadi' })
    next(error)
  }
})

// Activity log
router.get('/:id/activity', async (req, res, next) => {
  try {
    const activities = await prisma.activityLog.findMany({
      where: { dealId: Number(req.params.id) },
      include: { user: managerSelect },
      orderBy: { createdAt: 'desc' }
    })
    res.json(activities)
  } catch (error) { next(error) }
})

router.post('/:id/activity', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { details } = req.body
    if (!details) return res.status(400).json({ message: 'Izoh mazmuni majburiy' })
    const activity = await prisma.activityLog.create({
      data: { action: "Izoh qo'shildi", details, dealId: Number(req.params.id), userId: req.userId },
      include: { user: managerSelect }
    })
    res.status(201).json(activity)
  } catch (error) { next(error) }
})

// Get installments
router.get('/:id/installments', async (req, res, next) => {
  try {
    const installments = await prisma.installment.findMany({
      where: { dealId: Number(req.params.id) },
      orderBy: { dueDate: 'asc' }
    });
    res.json(installments);
  } catch (error) { next(error); }
});

// Save/replace installments
router.post('/:id/installments', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const dealId = Number(req.params.id);
    const { installments } = req.body;
    
    const result = await prisma.$transaction(async (tx) => {
      // Clear old installments and old auto-generated tasks
      await tx.installment.deleteMany({ where: { dealId } });
      await tx.task.deleteMany({
        where: {
          dealId,
          title: { startsWith: "To'lov eslatmasi" }
        }
      });
      
      const created = [];
      if (Array.isArray(installments)) {
        for (const inst of installments) {
          let dueDate = new Date(inst.dueDate);
          if (isNaN(dueDate.getTime())) {
            dueDate = new Date();
            // Defaulting to 1 month ahead if invalid date was passed
            dueDate.setMonth(dueDate.getMonth() + 1);
          }
          const item = await tx.installment.create({
            data: {
              dealId,
              dueDate: dueDate,
              amount: Number(inst.amount) || 0,
              paid: Boolean(inst.paid),
              productName: inst.productName || null,
              month: inst.month || null,
              notes: inst.notes || null
            }
          });
          created.push(item);

          // 3 kun oldingi avtomatlashtirilgan eslatma yaratish (agar to'lanmagan bo'lsa)
          if (!inst.paid) {
            const taskDueDate = new Date(dueDate);
            taskDueDate.setDate(taskDueDate.getDate() - 3);
            
            await tx.task.create({
              data: {
                title: `To'lov eslatmasi (Nasiya)`,
                description: `Ushbu sdelka uchun to'lov muddati: ${dueDate.toLocaleDateString('uz-UZ')}. To'lov summasi: ${inst.amount} so'm. Mahsulot: ${inst.productName || 'Noma\'lum'}`,
                dueDate: taskDueDate,
                assignedToId: req.userId,
                dealId: dealId,
                priority: 'high'
              }
            });
          }
        }
      }
      return created;
    });
    res.json(result);
  } catch (error) { next(error); }
});

module.exports = router
