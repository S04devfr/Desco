const express = require('express')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const userSelect = { select: { id: true, fullName: true, email: true, role: true } }

// List expenses (with optional category filter)
router.get('/', async (req, res, next) => {
  try {
    const { category, from, to } = req.query
    const where = {}

    if (category) where.category = category
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from)
      if (to) where.date.lte = new Date(to)
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: { createdBy: userSelect },
      orderBy: { date: 'desc' }
    })
    res.json(expenses)
  } catch (error) {
    next(error)
  }
})

// Get expense details
router.get('/:id', async (req, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({
      where: { id: Number(req.params.id) },
      include: { createdBy: userSelect }
    })
    if (!expense) return res.status(404).json({ message: 'Xarajat topilmadi' })
    res.json(expense)
  } catch (error) {
    next(error)
  }
})

// Create expense
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { description, amount, category, date } = req.body
    if (!description || amount === undefined) {
      return res.status(400).json({ message: 'Tavsif va summa majburiy' })
    }

    const expense = await prisma.expense.create({
      data: {
        description,
        amount: Number(amount),
        category: category || 'other',
        date: (date && !isNaN(new Date(date))) ? new Date(date) : new Date(),
        createdById: req.userId
      },
      include: { createdBy: userSelect }
    })
    res.status(201).json(expense)
  } catch (error) {
    next(error)
  }
})

// Update expense
router.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const { description, amount, category, date } = req.body

    const data = {}
    if (description !== undefined) data.description = description
    if (amount !== undefined) data.amount = Number(amount)
    if (category !== undefined) data.category = category
    if (date !== undefined) data.date = (date && !isNaN(new Date(date))) ? new Date(date) : new Date()

    const expense = await prisma.expense.update({
      where: { id: Number(req.params.id) },
      data,
      include: { createdBy: userSelect }
    })
    res.json(expense)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Xarajat topilmadi' })
    next(error)
  }
})

// Delete expense
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await prisma.expense.delete({ where: { id: Number(req.params.id) } })
    res.json({ message: 'Xarajat o\'chirildi' })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Xarajat topilmadi' })
    next(error)
  }
})

module.exports = router
