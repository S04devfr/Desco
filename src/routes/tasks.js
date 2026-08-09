const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const userSelect = { select: { id: true, fullName: true, email: true, role: true } }

// Format task client mapping (combining explicit task client/contact and parent deal client/contact)
function formatTaskClient(t) {
  if (!t) return null;

  // Backwards compatibility: map contact to client
  if (!t.client && t.contact) {
    t.client = {
      id: t.contact.id,
      name: `${t.contact.firstName} ${t.contact.lastName || ''}`.trim(),
      phone: t.contact.phone,
      city: t.contact.city,
      email: t.contact.email,
      company: t.contact.company ? t.contact.company.name : null
    };
  }

  if (t.deal && !t.deal.client && t.deal.contact) {
    t.deal.client = {
      id: t.deal.contact.id,
      name: `${t.deal.contact.firstName} ${t.deal.contact.lastName || ''}`.trim(),
      phone: t.deal.contact.phone,
      city: t.deal.contact.city,
      email: t.deal.contact.email,
      company: t.deal.contact.company ? t.deal.contact.company.name : null
    };
  }

  const finalClient = t.client || t.deal?.client || null;
  return {
    ...t,
    clientId: finalClient ? finalClient.id : null,
    client: finalClient
  };
}

// List tasks
router.get('/', async (req, res) => {
  try {
    const { completed, priority, dealId, mine } = req.query
    const where = (req.user && req.user.role === 'admin' && mine !== 'true') ? {} : { assignedToId: req.userId }

    if (completed !== undefined) where.completed = completed === 'true'
    if (priority) where.priority = priority
    if (dealId) where.dealId = Number(dealId)

    // ── Obsolete Callback Tasks Auto-Cleanup (Bitrix24/amoCRM style) ──
    try {
      const activeTasksWithDeals = await prisma.task.findMany({
        where: { completed: false, NOT: { dealId: null } },
        include: { deal: { include: { stage: true } } }
      });
      
      const isCallbackStage = (stageName) => {
        if (!stageName) return false;
        const name = stageName.toLowerCase();
        return name.includes('qayta aloqa') || 
               name.includes('vazifa') || 
               name.includes('ko\'tarmadi') || 
               name.includes('kotarmadi') || 
               name.includes('javob') || 
               name.includes('qayta');
      };

      const obsoleteTaskIds = activeTasksWithDeals
        .filter(t => {
          if (!t.deal) return false;
          
          const isCallbackTask = t.actionType === 'Связаться' || 
                                 t.actionType === 'Aloqaga chiqish' || 
                                 (t.title || '').toLowerCase().includes('qayta aloqa') ||
                                 (t.title || '').toLowerCase().includes('vazifa');
          if (!isCallbackTask) return false;

          const stageName = t.deal.stage?.name || '';
          return !isCallbackStage(stageName);
        })
        .map(t => t.id);

      if (obsoleteTaskIds.length > 0) {
        await prisma.task.updateMany({
          where: { id: { in: obsoleteTaskIds } },
          data: { completed: true, status: 'completed', result: "Avtomatik bajarildi: Sdelka bosqichi o'zgardi" }
        });
        console.log(`[Auto-Cleanup] ${obsoleteTaskIds.length} ta eskirgan vazifa yopildi.`);
      }

      // ── Clean up duplicate active tasks for the same deal (keeping only the latest one) ──
      const dealTaskGroups = {};
      activeTasksWithDeals.forEach(t => {
        if (!dealTaskGroups[t.dealId]) dealTaskGroups[t.dealId] = [];
        dealTaskGroups[t.dealId].push(t);
      });

      const duplicateTaskIdsToClose = [];
      for (const dealId in dealTaskGroups) {
        const group = dealTaskGroups[dealId];
        if (group.length > 1) {
          // Sort by id descending so the latest task is first
          group.sort((a, b) => b.id - a.id);
          // Keep the first one (latest), mark others to close
          const toClose = group.slice(1).map(t => t.id);
          duplicateTaskIdsToClose.push(...toClose);
        }
      }

      if (duplicateTaskIdsToClose.length > 0) {
        await prisma.task.updateMany({
          where: { id: { in: duplicateTaskIdsToClose } },
          data: { completed: true, status: 'completed', result: "Avtomatik yopildi: Yangi vazifa yaratildi" }
        });
        console.log(`[Auto-Cleanup] ${duplicateTaskIdsToClose.length} ta dublikat vazifa yopildi.`);
      }
    } catch (cleanupErr) {
      console.error('[Auto-Cleanup Error] Obsolete/duplicate tasks cleanup failed:', cleanupErr.message);
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            amount: true,
            paidAmount: true,
            status: true,
            notes: true,
            pipelineId: true,
            stageId: true,
            stage: { select: { id: true, name: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }]
    })

    if (!Array.isArray(tasks)) return res.json([])
    res.json(tasks.map(formatTaskClient))
  } catch (error) {
    console.error('[Tasks] GET / xato:', error.message)
    res.json([])
  }
})

// Get task by ID
router.get('/:id', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          include: {
            stage: { select: { id: true, name: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    })
    if (!task) return res.status(404).json({ message: 'Vazifa topilmadi' })
    res.json(formatTaskClient(task))
  } catch (error) { next(error) }
})

// Create task
router.post('/', async (req, res, next) => {
  try {
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, clientId, stageId, actionType, result } = req.body
    if (!title) return res.status(400).json({ message: 'Sarlavha majburiy' })

    const task = await prisma.task.create({
      data: {
        title,
        description: description || null,
        dueDate: (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null,
        dueTime: dueTime || null,
        priority: priority || 'medium',
        actionType: actionType || 'Aloqaga chiqish',
        result: result || null,
        dealId: dealId ? Number(dealId) : null,
        clientId: clientId ? Number(clientId) : null,
        contactId: req.body.contactId ? Number(req.body.contactId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : (typeof req.userId === 'number' ? req.userId : null)
      },
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    })

    if (stageId && task.dealId) {
      await prisma.deal.update({
        where: { id: task.dealId },
        data: { stageId: Number(stageId) }
      });
    }

    res.status(201).json(formatTaskClient(task))
  } catch (error) { next(error) }
})

// Update task
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, completed, clientId, stageId, actionType, result } = req.body

    const data = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (dueDate !== undefined) data.dueDate = (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null
    if (dueTime !== undefined) data.dueTime = dueTime
    if (priority !== undefined) data.priority = priority
    if (actionType !== undefined) data.actionType = actionType
    if (result !== undefined) data.result = result
    if (completed !== undefined) {
      data.completed = completed
      data.status = completed ? 'completed' : 'todo'
    } else if (stageId !== undefined && stageId !== null && stageId !== '') {
      data.completed = true
      data.status = 'completed'
    }
    if (dealId !== undefined) data.dealId = dealId ? Number(dealId) : null
    if (assignedToId !== undefined) data.assignedToId = assignedToId ? Number(assignedToId) : null
    if (clientId !== undefined) {
      data.clientId = clientId ? Number(clientId) : null
    }
    if (req.body.contactId !== undefined) {
      data.contactId = req.body.contactId ? Number(req.body.contactId) : null
    }

    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data,
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    })

    if (stageId && task.dealId) {
      await prisma.deal.update({
        where: { id: task.dealId },
        data: { stageId: Number(stageId) }
      });
    }

    res.json(formatTaskClient(task))
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Vazifa topilmadi' })
    next(error)
  }
})

// Complete task shortcut
router.patch('/:id/complete', async (req, res, next) => {
  try {
    const { result } = req.body
    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data: { completed: true, status: 'completed', result: result || null }
    })
    res.json(task)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Vazifa topilmadi' })
    next(error)
  }
})

// Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.task.delete({ where: { id: Number(req.params.id) } })
    res.json({ message: "Vazifa o'chirildi" })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Vazifa topilmadi' })
    next(error)
  }
})

module.exports = router
