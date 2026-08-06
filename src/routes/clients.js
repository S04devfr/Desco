const express = require('express');
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

const ownerSelect = { select: { id: true, fullName: true, email: true, role: true } };

// List contacts
router.get('/', async (req, res, next) => {
  try {
    const { q, ownerId, source, tag } = req.query;

    const baseWhere = {
      NOT: {
        AND: [
          {
            OR: [
              { instagramId: { not: null } },
              { telegramId: { not: null } }
            ]
          },
          {
            OR: [
              { phone: null },
              { phone: "" }
            ]
          },
          {
            deals: { none: {} }
          }
        ]
      }
    };

    const where = {
      AND: [baseWhere]
    };

    if (q) {
      where.AND.push({
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { email: { contains: q, mode: 'insensitive' } },
          { company: { name: { contains: q, mode: 'insensitive' } } }
        ]
      });
    }

    if (ownerId) {
      where.AND.push({ ownerId: Number(ownerId) });
    }

    if (source) {
      where.AND.push({ source: { equals: source, mode: 'insensitive' } });
    }

    if (tag) {
      where.AND.push({ tags: { has: tag } });
    }

    const contacts = await prisma.contact.findMany({
      where,
      include: {
        owner: ownerSelect,
        company: true,
        deals: { select: { id: true, title: true, amount: true, status: true, productName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Map Contact object to align with Client structure on frontend if necessary
    const mappedContacts = contacts.map(c => ({
      ...c,
      name: `${c.firstName} ${c.lastName || ''}`.trim(),
      companyName: c.company ? c.company.name : null,
      company: c.company ? c.company.name : null
    }));

    res.json(mappedContacts);
  } catch (error) {
    next(error);
  }
});

// Get contact details
router.get('/:id', async (req, res, next) => {
  try {
    let contact = await prisma.contact.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: ownerSelect,
        company: true,
        deals: { include: { manager: ownerSelect, stage: true } }
      }
    });
    if (!contact) return res.status(404).json({ message: 'Kontakt topilmadi' });

    // Map to client format for frontend compatibility
    const mappedContact = {
      ...contact,
      name: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      companyName: contact.company ? contact.company.name : null,
      company: contact.company ? contact.company.name : null
    };

    res.json(mappedContact);
  } catch (error) {
    next(error);
  }
});

// Create contact (with duplicate check & inline company creation)
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, companyId, companyName, notes, city, source, tags, position } = req.body;
    if (!name) return res.status(400).json({ message: 'Ism majburiy' });

    // 1. Duplicate check by phone or email
    if (phone) {
      const existingPhone = await prisma.contact.findFirst({
        where: { phone: phone.trim() }
      });
      if (existingPhone) {
        return res.status(400).json({ message: 'Ushbu telefon raqamiga ega kontakt tizimda allaqachon mavjud!' });
      }
    }

    if (email) {
      const existingEmail = await prisma.contact.findFirst({
        where: { email: email.trim().toLowerCase() }
      });
      if (existingEmail) {
        return res.status(400).json({ message: 'Ushbu emailga ega kontakt tizimda allaqachon mavjud!' });
      }
    }

    // 2. Resolve or create inline Company
    let resolvedCompanyId = companyId ? Number(companyId) : null;
    if (!resolvedCompanyId && companyName && companyName.trim()) {
      const newCompany = await prisma.company.create({
        data: {
          name: companyName.trim(),
          ownerId: req.userId
        }
      });
      resolvedCompanyId = newCompany.id;
    }

    // 3. Name split (firstName, lastName)
    const nameParts = name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ') || null;

    // Create Contact
    const contact = await prisma.contact.create({
      data: {
        firstName,
        lastName,
        phone: phone || null,
        email: email || null,
        notes: notes || null,
        source: source || 'oddiy',
        tags: Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []),
        position: position || null,
        companyId: resolvedCompanyId,
        ownerId: req.userId
      },
      include: {
        owner: ownerSelect,
        company: true
      }
    });

    const mapped = {
      ...contact,
      name: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      companyName: contact.company ? contact.company.name : null,
      company: contact.company ? contact.company.name : null
    };

    res.status(201).json(mapped);
  } catch (error) {
    next(error);
  }
});

// Update contact
router.patch('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, companyId, companyName, notes, source, tags, position } = req.body;
    const contactId = Number(req.params.id);

    // Duplicate check if phone or email changes
    if (phone) {
      const existingPhone = await prisma.contact.findFirst({
        where: {
          phone: phone.trim(),
          id: { not: contactId }
        }
      });
      if (existingPhone) {
        return res.status(400).json({ message: 'Ush2 telefon raqami boshqa kontaktga tegishli!' });
      }
    }

    if (email) {
      const existingEmail = await prisma.contact.findFirst({
        where: {
          email: email.trim().toLowerCase(),
          id: { not: contactId }
        }
      });
      if (existingEmail) {
        return res.status(400).json({ message: 'Ushbu email boshqa kontaktga tegishli!' });
      }
    }

    // Resolve or create inline Company
    let resolvedCompanyId = companyId !== undefined ? (companyId ? Number(companyId) : null) : undefined;
    if (resolvedCompanyId === null && companyName && companyName.trim()) {
      const newCompany = await prisma.company.create({
        data: {
          name: companyName.trim(),
          ownerId: req.userId
        }
      });
      resolvedCompanyId = newCompany.id;
    }

    const data = {};
    if (name !== undefined) {
      const nameParts = name.trim().split(/\s+/);
      data.firstName = nameParts[0];
      data.lastName = nameParts.slice(1).join(' ') || null;
    }
    if (phone !== undefined) data.phone = phone || null;
    if (email !== undefined) data.email = email || null;
    if (notes !== undefined) data.notes = notes || null;
    if (source !== undefined) data.source = source || 'oddiy';
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags : (tags ? String(tags).split(',').map(t => t.trim()).filter(Boolean) : []);
    if (position !== undefined) data.position = position || null;
    if (resolvedCompanyId !== undefined) data.companyId = resolvedCompanyId;

    const contact = await prisma.contact.update({
      where: { id: contactId },
      data,
      include: { owner: ownerSelect, company: true }
    });

    const mapped = {
      ...contact,
      name: `${contact.firstName} ${contact.lastName || ''}`.trim(),
      companyName: contact.company ? contact.company.name : null,
      company: contact.company ? contact.company.name : null
    };

    res.json(mapped);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Kontakt topilmadi' });
    next(error);
  }
});

// Delete contact
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const contactId = Number(req.params.id);

    const dealCount = await prisma.deal.count({ where: { contactId } });
    if (dealCount > 0) {
      return res.status(400).json({
        message: `Bu mijozga ${dealCount} ta sdelka biriktirilgan. Avval sdelkalarni o'chiring yoki boshqa mijozga o'tkazing.`
      });
    }

    await prisma.contact.delete({ where: { id: contactId } });
    res.json({ message: 'Mijoz o\'chirildi' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Kontakt topilmadi' });
    next(error);
  }
});

module.exports = router;
