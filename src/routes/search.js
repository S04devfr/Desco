const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()

router.use(protect)

// Global search API (/api/search?q=...)
router.get('/', async (req, res, next) => {
  try {
    const rawQ = (req.query.q || '').trim();

    if (!rawQ || rawQ.length < 2) {
      return res.json({ clients: [], deals: [], totalCount: 0 });
    }

    const q = rawQ.replace(/^#/, ''); // Strip leading # for ID search
    const cleanDigits = rawQ.replace(/\D/g, ''); // Extract only digits for phone search

    const possibleId = parseInt(q, 10);
    const isNum = !isNaN(possibleId) && String(possibleId) === q;

    const isPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));
    const mode = isPostgres ? 'insensitive' : undefined;

    // Search conditions for Deals
    const dealOrConditions = [
      { productName: { contains: q, mode } },
      { notes: { contains: q, mode } },
      { city: { contains: q, mode } },
      { clientName: { contains: q, mode } },
      { clientPhone: { contains: q, mode } },
      { client: { name: { contains: q, mode } } },
      { client: { phone: { contains: q, mode } } }
    ];

    if (isNum && possibleId > 0) {
      dealOrConditions.push({ id: possibleId });
    }

    if (cleanDigits.length >= 3) {
      dealOrConditions.push({ clientPhone: { contains: cleanDigits, mode } });
      dealOrConditions.push({ client: { phone: { contains: cleanDigits, mode } } });
    }

    // Search conditions for Clients
    const clientOrConditions = [
      { name: { contains: q, mode } },
      { phone: { contains: q, mode } },
      { city: { contains: q, mode } },
      { email: { contains: q, mode } }
    ];

    if (cleanDigits.length >= 3) {
      clientOrConditions.push({ phone: { contains: cleanDigits, mode } });
    }

    const [deals, clients] = await Promise.all([
      prisma.deal.findMany({
        where: { OR: dealOrConditions },
        include: {
          client: { select: { id: true, name: true, phone: true, city: true } },
          stage: { select: { id: true, name: true, color: true } }
        },
        orderBy: { updatedAt: 'desc' },
        take: 20
      }),
      prisma.client.findMany({
        where: { OR: clientOrConditions },
        include: {
          deals: { select: { id: true, productName: true, amount: true } }
        },
        take: 10
      })
    ]);

    const formattedDeals = deals.map(d => ({
      id: d.id,
      dealNumber: `#${d.id}`,
      title: d.productName || 'Sdelka',
      productName: d.productName || '',
      amount: d.amount || 0,
      clientName: d.clientName || d.client?.name || 'Mijoz',
      clientPhone: d.clientPhone || d.client?.phone || '',
      city: d.city || d.client?.city || '',
      stageName: d.stage?.name || 'Bosqichsiz',
      stageColor: d.stage?.color || '#007AFF',
      updatedAt: d.updatedAt
    }));

    const formattedClients = clients.map(c => ({
      id: c.id,
      name: c.name || 'Mijoz',
      phone: c.phone || '',
      city: c.city || '',
      dealCount: c.deals ? c.deals.length : 0
    }));

    res.json({
      deals: formattedDeals,
      clients: formattedClients,
      totalCount: formattedDeals.length + formattedClients.length
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router
