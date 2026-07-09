const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const userSelect = { select: { id: true, fullName: true, email: true, role: true } }

// clientId ni raw SQL orqali task'larga qo'shish (generated client bilmaydi)
async function enrichWithClient(tasks) {
  try {
    const ids = tasks.map(t => t.id)
    if (!ids.length) return tasks
    const ph = ids.map(() => '?').join(',')
    const rows = await prisma.$queryRawUnsafe(
      `SELECT t.id as taskId, t.clientId, c.name as clientName, c.company as clientCompany, c.phone as clientPhone,
              t.dealId, d.clientId as dealClientId, dc.name as dealClientName, dc.company as dealClientCompany, dc.phone as dealClientPhone
       FROM "Task" t 
       LEFT JOIN "Client" c ON t.clientId = c.id
       LEFT JOIN "Deal" d ON t.dealId = d.id
       LEFT JOIN "Client" dc ON d.clientId = dc.id
       WHERE t.id IN (${ph})`, ...ids
    )
    const map = {}
    for (const r of rows) map[Number(r.taskId)] = r
    return tasks.map(t => {
      const r = map[t.id]
      const finalClientId = r?.clientId ? Number(r.clientId) : (r?.dealClientId ? Number(r.dealClientId) : null);
      const finalClientName = r?.clientId ? r.clientName : r?.dealClientName;
      const finalClientCompany = r?.clientId ? r.clientCompany : r?.dealClientCompany;
      const finalClientPhone = r?.clientId ? r.clientPhone : r?.dealClientPhone;
      return {
        ...t,
        clientId: finalClientId,
        client: finalClientId ? { id: finalClientId, name: finalClientName, company: finalClientCompany, phone: finalClientPhone || null } : null
      }
    })
  } catch (e) { return tasks }
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

    const tasks = await prisma.task?.findMany?.({
      where,
      include: {
        assignedTo: userSelect,
        deal: { select: { id: true, productName: true } }
      },
      orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }]
    })

    if (!Array.isArray(tasks)) return res.json([])
    res.json(await enrichWithClient(tasks))
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
      include: { assignedTo: userSelect, deal: true }
    })
    if (!task) return res.status(404).json({ message: 'Vazifa topilmadi' })
    const [enriched] = await enrichWithClient([task])
    res.json(enriched)
  } catch (error) { next(error) }
})

// Create task
router.post('/', async (req, res, next) => {
  try {
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, clientId } = req.body
    if (!title) return res.status(400).json({ message: 'Sarlavha majburiy' })

    const task = await prisma.task.create({
      data: {
        title,
        description: description || null,
        dueDate: (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null,
        dueTime: dueTime || null,
        priority: priority || 'medium',
        dealId: dealId ? Number(dealId) : null,
        assignedToId: assignedToId ? Number(assignedToId) : req.userId
      },
      include: { assignedTo: userSelect, deal: { select: { id: true, productName: true } } }
    })

    if (clientId) {
      try {
        await prisma.$executeRawUnsafe('UPDATE "Task" SET clientId=? WHERE id=?', Number(clientId), task.id)
        const cl = await prisma.$queryRawUnsafe('SELECT id, name, company FROM "Client" WHERE id=?', Number(clientId))
        task.clientId = Number(clientId)
        task.client = cl[0] || null
      } catch (e) { /* ignore */ }
    }

    res.status(201).json(task)
  } catch (error) { next(error) }
})

// Update task
router.patch('/:id', async (req, res, next) => {
  try {
    const { title, description, dueDate, dueTime, dealId, assignedToId, priority, completed, clientId } = req.body

    const data = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (dueDate !== undefined) data.dueDate = (dueDate && !isNaN(new Date(dueDate))) ? new Date(dueDate) : null
    if (dueTime !== undefined) data.dueTime = dueTime
    if (priority !== undefined) data.priority = priority
    if (completed !== undefined) data.completed = completed
    if (dealId !== undefined) data.dealId = dealId ? Number(dealId) : null
    if (assignedToId !== undefined) data.assignedToId = assignedToId ? Number(assignedToId) : null

    const task = await prisma.task.update({
      where: { id: Number(req.params.id) },
      data,
      include: { assignedTo: userSelect }
    })

    if (clientId !== undefined) {
      try {
        const cid = clientId ? Number(clientId) : null
        await prisma.$executeRawUnsafe('UPDATE "Task" SET clientId=? WHERE id=?', cid, task.id)
        if (cid) {
          const cl = await prisma.$queryRawUnsafe('SELECT id, name, company FROM "Client" WHERE id=?', cid)
          task.clientId = cid
          task.client = cl[0] || null
        } else {
          task.clientId = null
          task.client = null
        }
      } catch (e) { /* ignore */ }
    }

    res.json(task)
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
