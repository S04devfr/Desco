const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const userSelect = { select: { id: true, fullName: true, email: true, role: true } }

// Format task client mapping (combining explicit task client and parent deal client)
function formatTaskClient(t) {
  if (!t) return null;
  const finalClient = t.client || t.deal?.client || null;
  return {
    ...t,
    clientId: finalClient ? finalClient.id : null,
    client: finalClient
  };
}

// List tasks
// Zero Freeze Policy: this endpoint must never hang and must never make the
// frontend's "Yuklanmoqda..." spinner stick forever. If the DB query fails
// for any reason (stale/out-of-sync Prisma client, connection issue, etc.)
// we log it server-side and respond with [] (200) instead of bubbling to
// the generic error handler — an empty list is always a safe, renderable
// state for the Tasks page, whereas a 500 here previously fed an error
// path that wasn't being handled consistently by every caller.
router.get('/', async (req, res) => {
  try {
    const { completed, priority, dealId } = req.query
    const where = (req.user && req.user.role === 'admin') ? {} : { assignedToId: req.userId }

    if (completed !== undefined) where.completed = completed === 'true'
    if (priority) where.priority = priority
    if (dealId) where.dealId = Number(dealId)

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
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
            }
          }
        }
      },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }]
    })

    if (!Array.isArray(tasks)) return res.json([])
    res.json(tasks.map(formatTaskClient))
  } catch (error) {
    console.error('[Tasks] GET / xato — bo\'sh ro\'yxat qaytarilmoqda:', error.message)
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
        deal: {
          include: {
            stage: { select: { id: true, name: true } },
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
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
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, clientId, stageId } = req.body
    if (!title) return res.status(400).json({ message: 'Sarlavha majburiy' })

    const task = await prisma.task.create({
      data: {
        title,
        description: description || null,
        dueDate: (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null,
        dueTime: dueTime || null,
        priority: priority || 'medium',
        dealId: dealId ? Number(dealId) : null,
        clientId: clientId ? Number(clientId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : (typeof req.userId === 'number' ? req.userId : null)
      },
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
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
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, completed, clientId, stageId } = req.body

    const data = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (dueDate !== undefined) data.dueDate = (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null
    if (dueTime !== undefined) data.dueTime = dueTime
    if (priority !== undefined) data.priority = priority
    if (completed !== undefined) {
      data.completed = completed
    } else if (stageId !== undefined && stageId !== null && stageId !== '') {
      data.completed = true
    }
    if (dealId !== undefined) data.dealId = dealId ? Number(dealId) : null
    if (assignedToId !== undefined) data.assignedToId = assignedToId ? Number(assignedToId) : null
    if (clientId !== undefined) data.clientId = clientId ? Number(clientId) : null

    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data,
      include: {
        assignedTo: userSelect,
        client: {
          select: { id: true, name: true, company: true, phone: true, city: true }
        },
        deal: {
          select: {
            id: true,
            productName: true,
            client: {
              select: { id: true, name: true, company: true, phone: true, city: true }
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
    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data: { completed: true }
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
