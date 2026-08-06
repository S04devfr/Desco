const express = require('express');
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

const ownerSelect = { select: { id: true, fullName: true, email: true, role: true } };

// List all companies
router.get('/', async (req, res, next) => {
  try {
    const { q } = req.query;
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { industry: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } }
          ]
        }
      : {};

    const companies = await prisma.company.findMany({
      where,
      include: {
        owner: ownerSelect,
        contacts: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        deals: { select: { id: true, title: true, amount: true, status: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(companies);
  } catch (error) {
    next(error);
  }
});

// Get company details
router.get('/:id', async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: ownerSelect,
        contacts: { include: { owner: ownerSelect } },
        deals: { include: { stage: true, owner: ownerSelect } }
      }
    });
    if (!company) return res.status(404).json({ message: 'Kompaniya topilmadi' });
    res.json(company);
  } catch (error) {
    next(error);
  }
});

// Create company
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, industry, website, phone, address } = req.body;
    if (!name) return res.status(400).json({ message: 'Kompaniya nomi majburiy' });

    const company = await prisma.company.create({
      data: {
        name,
        industry: industry || null,
        website: website || null,
        phone: phone || null,
        address: address || null,
        ownerId: req.userId
      },
      include: {
        owner: ownerSelect
      }
    });
    res.status(201).json(company);
  } catch (error) {
    next(error);
  }
});

// Update company
router.put('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, industry, website, phone, address } = req.body;
    if (!name) return res.status(400).json({ message: 'Kompaniya nomi majburiy' });

    const company = await prisma.company.update({
      where: { id: Number(req.params.id) },
      data: {
        name,
        industry: industry || null,
        website: website || null,
        phone: phone || null,
        address: address || null
      },
      include: {
        owner: ownerSelect
      }
    });
    res.json(company);
  } catch (error) {
    next(error);
  }
});

// Delete company
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const companyId = Number(req.params.id);
    
    // Check if company has contacts or deals
    const contactsCount = await prisma.contact.count({ where: { companyId } });
    const dealsCount = await prisma.deal.count({ where: { companyId } });
    if (contactsCount > 0 || dealsCount > 0) {
      return res.status(400).json({ message: 'Kompaniyaga bog\'langan kontaktlar yoki sdelkalar mavjud. Avval ularni o\'chiring yoki bog\'liqlikni uzing.' });
    }

    await prisma.company.delete({ where: { id: companyId } });
    res.json({ success: true, message: 'Kompaniya muvaffaqiyatli o\'chirildi' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
