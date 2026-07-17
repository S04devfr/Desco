const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

// Render plans page
router.get('/', async (req, res, next) => {
  res.render('plans/index', {
    title: 'Rejalar va Eslatmalar — DESCO CRM',
    activePage: 'plans',
    user: req.session.user || {}
  })
})

// Get all plans
router.get('/api', async (req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: {
          select: { id: true, fullName: true, role: true }
        }
      }
    })
    res.json(plans)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Create plan
router.post('/api', async (req, res, next) => {
  try {
    const { title, description, status, priority, color, dueDate } = req.body
    if (!title) {
      return res.status(400).json({ error: 'Sarlavha kiritilishi shart' })
    }
    const newPlan = await prisma.plan.create({
      data: {
        title,
        description,
        status: status || 'todo',
        priority: priority || 'medium',
        color: color || '#3b82f6',
        dueDate: dueDate ? new Date(dueDate) : null,
        creatorId: req.userId
      },
      include: {
        creator: {
          select: { id: true, fullName: true, role: true }
        }
      }
    })
    res.json(newPlan)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Update plan
router.patch('/api/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const { title, description, status, priority, color, dueDate } = req.body
    
    const updated = await prisma.plan.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(dueDate) : null } : {})
      },
      include: {
        creator: {
          select: { id: true, fullName: true, role: true }
        }
      }
    })
    res.json(updated)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Delete plan
router.delete('/api/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    await prisma.plan.delete({ where: { id } })
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

module.exports = router
