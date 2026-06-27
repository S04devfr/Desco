const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

// Deadline tekshirish va bildirishnoma yaratish
async function checkDeadlines(userId, role) {
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const where = {
    completed: false,
    dueDate: { not: null }
  }
  if (role !== 'admin') where.assignedToId = userId

  const tasks = await prisma.task.findMany({ where })
  const notifications = []

  for (const task of tasks) {
    const due = new Date(task.dueDate)
    if (due < now) {
      notifications.push({
        id: `overdue-${task.id}`,
        type: 'overdue',
        title: "Muddati o'tdi",
        message: `"${task.title}" vazifasi muddati o'tib ketdi`,
        taskId: task.id,
        dueDate: task.dueDate,
        createdAt: task.dueDate
      })
    } else if (due <= in24h) {
      notifications.push({
        id: `soon-${task.id}`,
        type: 'soon',
        title: '24 soat qoldi',
        message: `"${task.title}" vazifasi ${due.toLocaleDateString('uz-UZ')} da tugaydi`,
        taskId: task.id,
        dueDate: task.dueDate,
        createdAt: new Date()
      })
    }
  }

  return notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

// GET /api/notifications
router.get('/', async (req, res, next) => {
  try {
    const notifications = await checkDeadlines(req.userId, req.user.role)
    // O'qilganlarni session'da saqlash
    const readIds = req.session.readNotifIds || []
    const withRead = notifications.map(n => ({ ...n, read: readIds.includes(n.id) }))
    res.json(withRead)
  } catch (error) { next(error) }
})

// GET /api/notifications/count — faqat badge uchun
router.get('/count', async (req, res, next) => {
  try {
    const notifications = await checkDeadlines(req.userId, req.user.role)
    const readIds = req.session.readNotifIds || []
    const unread = notifications.filter(n => !readIds.includes(n.id)).length
    res.json({ unread })
  } catch (error) { next(error) }
})

// POST /api/notifications/read-all
router.post('/read-all', async (req, res) => {
  try {
    const notifications = await checkDeadlines(req.userId, req.user.role)
    req.session.readNotifIds = notifications.map(n => n.id)
    res.json({ ok: true })
  } catch (e) { res.json({ ok: false }) }
})

module.exports = router
