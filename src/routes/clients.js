const express = require('express')
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

const ownerSelect = { select: { id: true, fullName: true, email: true, role: true } }

// List clients (with optional search)
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query
    const where = q
      ? { OR: [{ name: { contains: q } }, { company: { contains: q } }, { phone: { contains: q } }] }
      : {}

    const clients = await prisma.client.findMany({
      where,
      include: {
        owner: ownerSelect,
        deals: { select: { id: true, productName: true, amount: true, status: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(clients)
  } catch (error) {
    next(error)
  }
})

// Get client details
router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: ownerSelect,
        deals: { include: { manager: ownerSelect } }
      }
    })
    if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' })
    res.json(client)
  } catch (error) {
    next(error)
  }
})

// Create client
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, company, notes, city } = req.body
    if (!name) return res.status(400).json({ message: 'Ism majburiy' })

    const client = await prisma.client.create({
      data: { name, phone: phone || null, email: email || null, company: company || null, notes: notes || null, city: city || null, ownerId: req.userId },
      include: { owner: ownerSelect }
    })
    res.status(201).json(client)
  } catch (error) {
    next(error)
  }
})

// Update client
router.patch('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, company, notes, debt, city } = req.body

    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone
    if (email !== undefined) data.email = email
    if (company !== undefined) data.company = company
    if (notes !== undefined) data.notes = notes
    if (debt !== undefined) data.debt = Number(debt) || 0
    if (city !== undefined) data.city = city

    const client = await prisma.client.update({
      where: { id: Number(req.params.id) },
      data,
      include: { owner: ownerSelect }
    })
    res.json(client)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Mijoz topilmadi' })
    next(error)
  }
})

// Delete client
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await prisma.client.delete({ where: { id: Number(req.params.id) } })
    res.json({ message: 'Mijoz o\'chirildi' })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Mijoz topilmadi' })
    next(error)
  }
})

module.exports = router
