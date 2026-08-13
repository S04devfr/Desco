const express = require('express');
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

const ownerSelect = { select: { id: true, fullName: true, email: true, role: true } };

// List clients
router.get('/', async (req, res, next) => {
  try {
    const { q, ownerId } = req.query;

    const where = { AND: [] };

    if (q) {
      where.AND.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          { city: { contains: q, mode: 'insensitive' } }
        ]
      });
    }

    if (ownerId) {
      where.AND.push({ ownerId: Number(ownerId) });
    }

    const clients = await prisma.client.findMany({
      where: where.AND.length > 0 ? where : {},
      include: {
        owner: ownerSelect,
        deals: { select: { id: true, productName: true, amount: true, paidAmount: true, status: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(clients);
  } catch (error) {
    next(error);
  }
});

// Get client details
router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: ownerSelect,
        deals: { include: { manager: ownerSelect, stage: true } },
        callLogs: { orderBy: { createdAt: 'desc' }, take: 20 }
      }
    });
    if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' });
    res.json(client);
  } catch (error) {
    next(error);
  }
});

// Create client
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, notes, city, debt, debtDate, debtNotes } = req.body;
    if (!name) return res.status(400).json({ message: 'Mijoz ismi majburiy' });

    // Duplicate check by phone
    if (phone) {
      const existing = await prisma.client.findFirst({
        where: { phone: phone.trim() }
      });
      if (existing) {
        return res.status(400).json({ message: 'Ushbu telefon raqamiga ega mijoz allaqachon mavjud!' });
      }
    }

    const client = await prisma.client.create({
      data: {
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        email: email ? email.trim().toLowerCase() : null,
        notes: notes || null,
        city: city || null,
        debt: Number(debt) || 0,
        debtDate: debtDate ? new Date(debtDate) : null,
        debtNotes: debtNotes || null,
        ownerId: req.userId
      },
      include: {
        owner: ownerSelect
      }
    });

    res.status(201).json(client);
  } catch (error) {
    next(error);
  }
});

// Update client
router.patch('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, notes, city, debt, debtDate, debtNotes } = req.body;
    const clientId = Number(req.params.id);

    // Duplicate check if phone changes
    if (phone) {
      const existing = await prisma.client.findFirst({
        where: {
          phone: phone.trim(),
          id: { not: clientId }
        }
      });
      if (existing) {
        return res.status(400).json({ message: 'Ushbu telefon raqami boshqa mijozga tegishli!' });
      }
    }

    const data = {};
    if (name !== undefined) data.name = name.trim();
    if (phone !== undefined) data.phone = phone ? phone.trim() : null;
    if (email !== undefined) data.email = email ? email.trim().toLowerCase() : null;
    if (notes !== undefined) data.notes = notes || null;
    if (city !== undefined) data.city = city || null;
    if (debt !== undefined) data.debt = Number(debt) || 0;
    if (debtDate !== undefined) data.debtDate = debtDate ? new Date(debtDate) : null;
    if (debtNotes !== undefined) data.debtNotes = debtNotes || null;

    const client = await prisma.client.update({
      where: { id: clientId },
      data,
      include: { owner: ownerSelect }
    });

    res.json(client);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Mijoz topilmadi' });
    next(error);
  }
});

// Delete client
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const clientId = Number(req.params.id);

    const dealCount = await prisma.deal.count({ where: { clientId } });
    if (dealCount > 0) {
      return res.status(400).json({
        message: `Bu mijozga ${dealCount} ta sdelka biriktirilgan. Avval sdelkalarni o'chiring yoki boshqa mijozga o'tkazing.`
      });
    }

    await prisma.client.delete({ where: { id: clientId } });
    res.json({ message: 'Mijoz o\'chirildi' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Mijoz topilmadi' });
    next(error);
  }
});

module.exports = router;
