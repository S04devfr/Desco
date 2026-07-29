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
    
    // Exclude clients who are just chat contacts (have chat ID, no phone, and no deals)
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

    const where = q
      ? {
          AND: [
            baseWhere,
            { OR: [{ name: { contains: q } }, { company: { contains: q } }, { phone: { contains: q } }] }
          ]
        }
      : baseWhere;

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
    let client = await prisma.client.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        owner: ownerSelect,
        deals: { include: { manager: ownerSelect } }
      }
    })
    if (!client) return res.status(404).json({ message: 'Mijoz topilmadi' })

    // Dynamically resolve missing Instagram/Telegram profile info from Wazzup
    if ((client.instagramId && (!client.instagramUsername || client.name.startsWith('Instagram Lead'))) ||
        (client.telegramId && !client.telegramUsername)) {
      const settings = await prisma.companySettings.findFirst();
      const WAZZUP_API_KEY = process.env.WAZZUP_API_KEY || (settings?.instagramAccessToken && settings.instagramAccessToken.length === 32 ? settings.instagramAccessToken : null);
      if (WAZZUP_API_KEY) {
        try {
          const contactId = client.instagramId || client.telegramId;
          const contactRes = await fetch(`https://api.wazzup24.com/v3/contacts/${contactId}`, {
            headers: { 'Authorization': `Bearer ${WAZZUP_API_KEY}` }
          });
          if (contactRes.ok) {
            const contactData = await contactRes.json();
            const updateData = {};
            
            // Extract username from contactData array
            if (contactData.contactData && Array.isArray(contactData.contactData)) {
              if (client.instagramId) {
                const igData = contactData.contactData.find(c => c.chatType === 'instagram' || c.chatType === 'instagramComment');
                if (igData && igData.username) {
                  updateData.instagramUsername = igData.username;
                }
              } else if (client.telegramId) {
                const tgData = contactData.contactData.find(c => c.chatType === 'telegram');
                if (tgData && tgData.username) {
                  updateData.telegramUsername = tgData.username;
                }
              }
            }

            // Extract contact name if it is not generic and is set
            if (contactData.name && contactData.name !== contactId && !contactData.name.startsWith('Instagram Lead') && !contactData.name.startsWith('Telegram Lead')) {
              updateData.name = contactData.name;
            }

            if (Object.keys(updateData).length > 0) {
              client = await prisma.client.update({
                where: { id: client.id },
                data: updateData,
                include: {
                  owner: ownerSelect,
                  deals: { include: { manager: ownerSelect } }
                }
              });
              console.log(`[Wazzup Profile Sync] Successfully resolved and updated contact:`, updateData);
            }
          }
        } catch (err) {
          console.error('[Wazzup Profile Sync] Failed to fetch contact from Wazzup:', err);
        }
      }
    }

    res.json(client)
  } catch (error) {
    next(error)
  }
})

// Create client
router.post('/', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { name, phone, email, company, notes, city, debt, debtDate, debtNotes } = req.body
    if (!name) return res.status(400).json({ message: 'Ism majburiy' })

    const client = await prisma.client.create({
      data: {
        name,
        phone: phone || null,
        email: email || null,
        company: company || null,
        notes: notes || null,
        city: city || null,
        debt: debt ? Number(debt) : 0,
        debtDate: (debtDate && !isNaN(new Date(debtDate))) ? new Date(debtDate) : (debt ? new Date() : null),
        debtNotes: debtNotes || null,
        ownerId: req.userId
      },
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
    const { name, phone, email, company, notes, debt, city, debtDate, debtNotes } = req.body

    const data = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone
    if (email !== undefined) data.email = email
    if (company !== undefined) data.company = company
    if (notes !== undefined) data.notes = notes
    if (debt !== undefined) data.debt = Number(debt) || 0
    if (city !== undefined) data.city = city
    if (debtDate !== undefined) data.debtDate = (debtDate && !isNaN(new Date(debtDate))) ? new Date(debtDate) : null
    if (debtNotes !== undefined) data.debtNotes = debtNotes

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
    const clientId = Number(req.params.id);

    // Avval tegishli sdelkalar borligini tekshirish
    const dealCount = await prisma.deal.count({ where: { clientId } });
    if (dealCount > 0) {
      return res.status(400).json({
        message: `Bu mijozga ${dealCount} ta sdelka biriktirilgan. Avval sdelkalarni o'chiring yoki boshqa mijozga o'tkazing.`
      });
    }

    await prisma.client.delete({ where: { id: clientId } })
    res.json({ message: 'Mijoz o\'chirildi' })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Mijoz topilmadi' })
    next(error)
  }
})

module.exports = router
