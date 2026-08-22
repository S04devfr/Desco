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
    const { completed, priority, dealId, mine } = req.query;

    const isAdminAll = (req.user && req.user.role === 'admin' && mine !== 'true');

    const where = isAdminAll
      ? {}
      : {
          OR: [
            { assignedToId: req.userId },
            { deal: { managerId: req.userId } },
            { deal: { ownerId: req.userId } }
          ]
        };

    if (completed !== undefined) where.completed = completed === 'true';
    if (priority) where.priority = priority;
    if (dealId) where.dealId = Number(dealId);

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
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
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(tasks.map(formatTaskClient));
  } catch (error) {
    res.status(500).json({ message: 'Vazifalarni yuklashda xatolik: ' + error.message });
  }
});

// Get task by ID
router.get('/:id', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          include: {
            stage: { select: { id: true, name: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
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
        dueDate: (() => {
          if (!dueDate) return null;
          const timeStr = (dueTime && dueTime.trim()) ? dueTime.trim() : '18:00';
          const rawDateStr = typeof dueDate === 'string' ? (dueDate.includes('T') ? dueDate.split('T')[0] : dueDate) : new Date(dueDate).toISOString().split('T')[0];
          const parsed = new Date(rawDateStr + 'T' + timeStr + ':00+05:00');
          return !isNaN(parsed.getTime()) ? parsed : new Date(dueDate);
        })(),
        dueTime: dueTime || '18:00',
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
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    })

    if (task.dealId) {
      const dealUpdate = {};
      const targetDeal = await prisma.deal.findUnique({ where: { id: task.dealId }, include: { stage: true } });
      if (targetDeal) {
        if (targetDeal.managerId === null && req.userId) {
          dealUpdate.managerId = req.userId;
        }
        if (stageId && Number(stageId) !== targetDeal.stageId) {
          const newStage = await prisma.pipelineStage.findUnique({ where: { id: Number(stageId) } });
          if (newStage) {
            dealUpdate.stageId = newStage.id;
            dealUpdate.stageUpdatedAt = new Date();

            let finalStatus = targetDeal.status;
            if (newStage.statusType === 'won') finalStatus = 'won';
            else if (newStage.statusType === 'lost') finalStatus = 'lost';
            else {
              const stName = newStage.name.toLowerCase();
              if (stName.includes('yutil') || stName.includes('100%') || stName.includes('olindi')) finalStatus = 'won';
              else if (stName.includes('rad') || stName.includes('otkaz') || stName.includes('lost')) finalStatus = 'lost';
            }
            dealUpdate.status = finalStatus;

            await prisma.dealStageHistory.create({
              data: {
                dealId: targetDeal.id,
                fromStageId: targetDeal.stageId,
                toStageId: newStage.id,
                changedById: req.userId,
                changedAt: new Date()
              }
            });

            await prisma.activityLog.create({
              data: {
                action: "Bosqich o'zgartirildi",
                details: `Vazifalar bo'limidan: ${targetDeal.stage?.name || 'Bosqichsiz'} → ${newStage.name}`,
                dealId: targetDeal.id,
                userId: req.userId
              }
            });

            // If moved to a non-callback stage, complete open tasks
            const isCallback = newStage.name.toLowerCase().includes('qayta') || newStage.name.toLowerCase().includes('aloqa') || newStage.name.toLowerCase().includes('ko\'tarmadi') || newStage.name.toLowerCase().includes('kotarmadi') || newStage.name.toLowerCase().includes('vazifa');
            if (!isCallback || finalStatus === 'won' || finalStatus === 'lost') {
              await prisma.task.updateMany({
                where: { dealId: targetDeal.id, completed: false, id: { not: task.id } },
                data: { completed: true, status: 'completed', result: `Avtomatik yopildi: Bosqich "${newStage.name}"ga o'zgartirildi` }
              });
            }
          }
        }
        if (Object.keys(dealUpdate).length > 0) {
          await prisma.deal.update({
            where: { id: task.dealId },
            data: dealUpdate
          }).catch(() => {});

          const broadcast = req.app.get('broadcast');
          if (broadcast) {
            const fullDeal = await prisma.deal.findUnique({
              where: { id: task.dealId },
              include: {
                client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
                manager: userSelect,
                stage: { select: { id: true, name: true, color: true, order: true } },
                installments: { select: { id: true } },
                tasks: { select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true, completed: true, createdAt: true, assignedToId: true } }
              }
            });
            if (fullDeal) broadcast({ type: 'deal_updated', dealId: task.dealId, deal: fullDeal });
          }
        }
      }
    }

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'task_created', taskId: task.id, task: formatTaskClient(task) });
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
    if (dueDate !== undefined || dueTime !== undefined) {
      const rawDate = dueDate !== undefined ? dueDate : null;
      const rawTime = dueTime !== undefined ? dueTime : '18:00';
      if (rawDate) {
        const rawDateStr = typeof rawDate === 'string' ? (rawDate.includes('T') ? rawDate.split('T')[0] : rawDate) : new Date(rawDate).toISOString().split('T')[0];
        const timeStr = (rawTime && rawTime.trim()) ? rawTime.trim() : '18:00';
        const parsed = new Date(rawDateStr + 'T' + timeStr + ':00+05:00');
        data.dueDate = !isNaN(parsed.getTime()) ? parsed : new Date(rawDate);
        data.dueTime = timeStr;
      } else if (dueTime !== undefined) {
        data.dueTime = dueTime;
      }
    }
    if (priority !== undefined) data.priority = priority
    if (actionType !== undefined) data.actionType = actionType
    if (result !== undefined) data.result = result
    if (completed !== undefined) {
      data.completed = Boolean(completed)
      data.status = Boolean(completed) ? 'completed' : 'todo'
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
          select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
        },
        contact: {
          include: { company: true }
        },
        deal: {
          include: {
            stage: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, phone2: true, city: true }
            },
            contact: {
              include: { company: true }
            }
          }
        }
      }
    });

    // If stageId was provided and dealId exists, check if stage actually changed
    if (stageId && task.dealId) {
      const newStageIdNum = Number(stageId);
      const targetDeal = await prisma.deal.findUnique({
        where: { id: task.dealId },
        include: { stage: true }
      });

      if (targetDeal && targetDeal.stageId !== newStageIdNum) {
        const newStage = await prisma.pipelineStage.findUnique({ where: { id: newStageIdNum } });
        if (newStage) {
          let finalStatus = targetDeal.status;
          if (newStage.statusType === 'won') {
            finalStatus = 'won';
          } else if (newStage.statusType === 'lost') {
            finalStatus = 'lost';
          } else {
            const stName = newStage.name.toLowerCase();
            if (stName.includes('yutil') || stName.includes('100%') || stName.includes('olindi')) finalStatus = 'won';
            else if (stName.includes('rad') || stName.includes('otkaz') || stName.includes('lost')) finalStatus = 'lost';
          }

          // Update deal with stage history
          await prisma.dealStageHistory.create({
            data: {
              dealId: targetDeal.id,
              fromStageId: targetDeal.stageId,
              toStageId: newStage.id,
              changedById: req.userId,
              changedAt: new Date()
            }
          });

          await prisma.deal.update({
            where: { id: targetDeal.id },
            data: {
              stageId: newStage.id,
              status: finalStatus,
              stageUpdatedAt: new Date()
            }
          });

          await prisma.activityLog.create({
            data: {
              action: "Bosqich o'zgartirildi",
              details: `Vazifalar bo'limidan: ${targetDeal.stage?.name || 'Bosqichsiz'} → ${newStage.name}`,
              dealId: targetDeal.id,
              userId: req.userId
            }
          });

          // If moved to a non-callback stage or won/lost, complete open tasks
          const isCallback = newStage.name.toLowerCase().includes('qayta') || newStage.name.toLowerCase().includes('aloqa') || newStage.name.toLowerCase().includes('ko\'tarmadi') || newStage.name.toLowerCase().includes('kotarmadi') || newStage.name.toLowerCase().includes('vazifa');
          if (!isCallback || finalStatus === 'won' || finalStatus === 'lost') {
            await prisma.task.updateMany({
              where: { dealId: targetDeal.id, completed: false },
              data: { completed: true, status: 'completed', result: `Avtomatik yopildi: Bosqich "${newStage.name}"ga o'zgartirildi` }
            });
          }

          const broadcast = req.app.get('broadcast');
          if (broadcast) {
            const fullDeal = await prisma.deal.findUnique({
              where: { id: targetDeal.id },
              include: {
                client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
                manager: userSelect,
                stage: { select: { id: true, name: true, color: true, order: true } },
                installments: { select: { id: true } },
                tasks: { select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true, completed: true, createdAt: true, assignedToId: true } }
              }
            });
            if (fullDeal) broadcast({ type: 'deal_updated', dealId: targetDeal.id, deal: fullDeal });
          }
        }
      }
    }

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'task_updated', taskId: task.id, task: formatTaskClient(task) });
      if (task.dealId) {
        const fullDeal = await prisma.deal.findUnique({
          where: { id: task.dealId },
          include: {
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
            manager: userSelect,
            stage: { select: { id: true, name: true, color: true, order: true } },
            installments: { select: { id: true } },
            tasks: { select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true, completed: true, createdAt: true, assignedToId: true } }
          }
        });
        if (fullDeal) broadcast({ type: 'deal_updated', dealId: task.dealId, deal: fullDeal });
      }
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
      data: { completed: true, status: 'completed', result: result || 'Bajarildi' },
      include: {
        assignedTo: userSelect,
        client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
        deal: {
          select: {
            id: true,
            productName: true,
            stageId: true,
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } }
          }
        }
      }
    });

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'task_updated', taskId: task.id, task: formatTaskClient(task) });
      if (task.dealId) {
        const fullDeal = await prisma.deal.findUnique({
          where: { id: task.dealId },
          include: {
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
            manager: userSelect,
            stage: { select: { id: true, name: true, color: true, order: true } },
            installments: { select: { id: true } },
            tasks: { select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true, completed: true, createdAt: true, assignedToId: true } }
          }
        });
        if (fullDeal) broadcast({ type: 'deal_updated', dealId: task.dealId, deal: fullDeal });
      }
    }

    res.json(formatTaskClient(task))
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Vazifa topilmadi' })
    next(error)
  }
})

// Delete task
router.delete('/:id', async (req, res, next) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: Number(req.params.id) } });
    await prisma.task.delete({ where: { id: Number(req.params.id) } });

    const broadcast = req.app.get('broadcast');
    if (broadcast) {
      broadcast({ type: 'task_deleted', taskId: Number(req.params.id) });
      if (task && task.dealId) {
        const fullDeal = await prisma.deal.findUnique({
          where: { id: task.dealId },
          include: {
            client: { select: { id: true, name: true, company: true, phone: true, phone2: true, city: true } },
            manager: userSelect,
            stage: { select: { id: true, name: true, color: true, order: true } },
            installments: { select: { id: true } },
            tasks: { select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true, completed: true, createdAt: true, assignedToId: true } }
          }
        });
        if (fullDeal) broadcast({ type: 'deal_updated', dealId: task.dealId, deal: fullDeal });
      }
    }

    res.json({ message: "Vazifa o'chirildi" })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Vazifa topilmadi' })
    next(error)
  }
})

module.exports = router
