const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)

// Global search
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim()

    if (!q) {
      return res.json({ clients: [], deals: [] })
    }

    const clients = await prisma.client.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { phone: { contains: q } },
          { email: { contains: q } }
        ]
      },
      take: 10
    })

    const deals = await prisma.deal.findMany({
      where: {
        OR: [
          { productName: { contains: q } }
        ]
      },
      take: 10
    })

    res.json({ clients, deals })
  } catch (error) {
    next(error)
  }
})

module.exports = router
