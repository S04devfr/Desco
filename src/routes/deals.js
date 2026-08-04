const express = require('express') // v2 fixed
const prisma = require('../config/database')
const { protect, requireRole } = require('../middleware/auth')

const router = express.Router()

async function validateMandatoryFields(req, body, isUpdate = false) {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings || !settings.mandatoryFields) return null;
    const fields = settings.mandatoryFields.split(',').map(f => f.trim()).filter(Boolean);

    const labels = {
      productName: 'Mahsulot nomi',
      amount: 'Бюджет (Summa)',
      notes: 'Izoh',
      deadline: 'Mijoz oladigan vaqt',
      warehouse: 'Ombor',
      contactPhone: 'Telefon raqami',
      contactName: 'Mijoz ismi',
      city: 'Shahri',
      source: 'Sdelka manbasi'
    };

    for (const field of fields) {
      let value = body[field];
      if (field === 'contactPhone') value = body.contactPhone || body.phone;
      if (field === 'contactName') value = body.contactName || body.name;

      const isFieldPassed = req.body[field] !== undefined ||
        (field === 'contactPhone' && (req.body.contactPhone !== undefined || req.body.phone !== undefined)) ||
        (field === 'contactName' && (req.body.contactName !== undefined || req.body.name !== undefined));

      if (!isUpdate || isFieldPassed) {
        if (value === undefined || value === null || String(value).trim() === '' || (field === 'amount' && Number(value) <= 0)) {
          return `${labels[field] || field} to'ldirilishi majburiy`;
        }
      }
    }
  } catch (e) {
    console.error('Validation error:', e);
  }
  return null;
}

router.use(protect)

// NOTE: /fix-unclaim o'chirildi — autentifikatsiyasiz ishlayotgan xavfli debug script edi



const managerSelect = { select: { id: true, fullName: true, email: true, role: true } }
const stageSelect = { select: { id: true, name: true, color: true, order: true, statusType: true } }

async function logActivity(dealId, userId, action, details) {
  try {
    await prisma.activityLog.create({ data: { action, details, dealId, userId } })
  } catch (e) { /* ignore */ }
}

// List deals
router.get('/', async (req, res, next) => {
  try {
    const { status, managerId, clientId, stageId, pipelineId, q } = req.query
    const where = {}
    if (status) where.status = status
    if (managerId) where.managerId = Number(managerId)
    if (clientId) where.clientId = Number(clientId)
    if (stageId) where.stageId = Number(stageId)

    // pipelineId filter: find stageIds belonging to that pipeline
    if (pipelineId) {
      try {
        const pipe = await prisma.pipeline.findUnique({
          where: { id: Number(pipelineId) },
          select: { name: true }
        });
        const stageRows = await prisma.pipelineStage.findMany({
          where: { pipelineId: Number(pipelineId) },
          select: { id: true, name: true }
        });
        const stageIds = stageRows.map(r => r.id);
        
        if (pipe && pipe.name.toLowerCase().includes('zakaz')) {
          const yetibBordiStage = stageRows.find(r => r.name.toLowerCase().includes('bordi'));
          if (yetibBordiStage) {
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (!where.AND) where.AND = [];
            where.AND.push({ stageId: { in: stageIds } });
            where.AND.push({
              OR: [
                { stageId: { not: yetibBordiStage.id } },
                {
                  stageId: yetibBordiStage.id,
                  updatedAt: { gte: oneDayAgo }
                }
              ]
            });
          } else {
            where.stageId = { in: stageIds };
          }
        } else {
          where.stageId = { in: stageIds };
        }
      } catch(e) { /* ignore, show all */ }
    }

    // Admin barcha sdelkalarni ko'ra oladi. Manager va Operator faqat o'ziga tegishli yoki unassigned(bo'sh) sdelkalarni.
    if (req.user?.role !== 'admin') {
      where.OR = [
        { managerId: null },
        { managerId: req.userId }
      ]
    }

    if (q) {
      const searchLower = q.toLowerCase().trim();
      const cleanId = searchLower.startsWith('#') ? searchLower.substring(1) : searchLower;
      const idNum = Number(cleanId);
      const isPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));
      const mode = isPostgres ? 'insensitive' : undefined;

      const searchConditions = [
        { productName: { contains: searchLower, mode } },
        { client: { name: { contains: searchLower, mode } } },
        { client: { phone: { contains: searchLower, mode } } },
        { client: { city: { contains: searchLower, mode } } },
        { manager: { fullName: { contains: searchLower, mode } } },
        { manager: { email: { contains: searchLower, mode } } }
      ];

      if (!isNaN(idNum)) {
        searchConditions.push({ id: idNum });
      }

      if (where.OR) {
        if (!where.AND) where.AND = [];
        where.AND.push({ OR: where.OR });
        where.AND.push({ OR: searchConditions });
        delete where.OR;
      } else {
        if (where.AND) {
          where.AND.push({ OR: searchConditions });
        } else {
          where.OR = searchConditions;
        }
      }
    }

    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true, companyPhone: true, companyEmail: true, companyWebsite: true, companyAddress: true, email: true } },
        manager: managerSelect,
        stage: stageSelect,
        installments: { select: { id: true } },
        tasks: {
          where: { completed: false },
          select: { id: true, title: true, dueDate: true, dueTime: true, actionType: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(deals);
  } catch (error) { next(error) }
})

// Get deal details
router.get('/:id', async (req, res, next) => {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true, companyPhone: true, companyEmail: true, companyWebsite: true, companyAddress: true, email: true } },
        manager: managerSelect,
        stage: stageSelect,
        tasks: true,
        activities: {
          include: { user: managerSelect },
          orderBy: { createdAt: 'desc' },
          take: 20
        }
      }
    })
    if (!deal) return res.status(404).json({ message: 'Sdelka topilmadi' })

    if (req.user?.role !== 'admin' && deal.managerId !== null && deal.managerId !== req.userId) {
      return res.status(403).json({ message: "Bu sdelkani ko'rish huquqiga ega emassiz" })
    }

    if (!deal.activities) deal.activities = []
    res.json(deal)
  } catch (error) { next(error) }
})

// Create deal.
// Supports two input shapes:
//  1) classic — clientId pointing at an existing Client
//  2) "Быстрое добавление" quick-add — inline contact/company fields
//     (contactName, contactPhone, contactEmail, companyName, companyAddress).
//     When clientId is absent but any of those are provided, a new Client
//     row is auto-created first and the deal is linked to it.
    const valError = await validateMandatoryFields(req, req.body, false);
    if (valError) return res.status(400).json({ message: valError });

    const {
      productName, amount, paidAmount, status, notes, clientId, deadline, stageId, pipelineId,
      contactName, contactPhone, contactEmail, companyName, companyAddress, city, costPrice, createdAt, warehouse,
      productColor, driverPhone, tags
    } = req.body
    if (!productName) return res.status(400).json({ message: 'Mahsulot nomi majburiy' })

    let resolvedClientId = clientId ? Number(clientId) : null

    if (!resolvedClientId) {
      const hasQuickAddFields = [contactName, contactPhone, contactEmail, companyName, companyAddress, city, req.body.companyPhone, req.body.companyEmail, req.body.companyWebsite]
        .some(v => v !== undefined && v !== null && String(v).trim() !== '')

      if (hasQuickAddFields) {
        const newClient = await prisma.client.create({
          data: {
            name: (contactName && contactName.trim()) || (companyName && companyName.trim()) || "Noma'lum mijoz",
            phone: contactPhone || null,
            city: city || null,
            email: contactEmail || null,
            company: companyName || null,
            companyAddress: companyAddress || null,
            companyPhone: req.body.companyPhone || null,
            companyEmail: req.body.companyEmail || null,
            companyWebsite: req.body.companyWebsite || null,
            ownerId: req.userId
          }
        })
        resolvedClientId = newClient.id
      }
    }

    let resolvedPipelineId = pipelineId ? Number(pipelineId) : null
    let resolvedStageId = stageId ? Number(stageId) : null

    // Resolve pipelineId from stageId if stageId is provided but pipelineId is missing
    if (!resolvedPipelineId && resolvedStageId) {
      const stage = await prisma.pipelineStage.findUnique({
        where: { id: resolvedStageId }
      })
      if (stage && stage.pipelineId) {
        resolvedPipelineId = stage.pipelineId
      }
    }

    // Resolve default pipelineId if pipelineId is still missing
    if (!resolvedPipelineId) {
      const defaultPipeline = await prisma.pipeline.findFirst({
        where: { isDefault: true }
      })
      if (defaultPipeline) {
        resolvedPipelineId = defaultPipeline.id
      } else {
        const firstPipeline = await prisma.pipeline.findFirst()
        if (firstPipeline) {
          resolvedPipelineId = firstPipeline.id
        }
      }
    }

    // Resolve stageId if missing
    if (resolvedPipelineId && !resolvedStageId) {
      const firstStage = await prisma.pipelineStage.findFirst({
        where: { pipelineId: resolvedPipelineId },
        orderBy: { order: 'asc' }
      })
      if (firstStage) {
        resolvedStageId = firstStage.id
      }
    }

    const deal = await prisma.deal.create({
      data: {
        productName,
        amount: amount ? Number(amount) : 0,
        paidAmount: paidAmount ? Number(paidAmount) : 0,
        costPrice: costPrice ? Number(costPrice) : 0,
        status: status || 'new',
        notes: notes || null,
        deadline: (deadline && !isNaN(new Date(deadline))) ? new Date(deadline) : null,
        createdAt: (createdAt && !isNaN(new Date(createdAt))) ? new Date(createdAt) : new Date(),
        clientId: resolvedClientId,
        managerId: req.userId,
        stageId: resolvedStageId,
        pipelineId: resolvedPipelineId,
        warehouse: warehouse || null,
        source: req.body.source || 'oddiy',
        productColor: productColor || 'oddiy',
        driverPhone: driverPhone || null,
        tags: tags || '',
        stageUpdatedAt: new Date()
      },
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true, companyPhone: true, companyEmail: true, companyWebsite: true, companyAddress: true, email: true } },
        manager: managerSelect,
        stage: stageSelect
      }
    })

    await logActivity(deal.id, req.userId, 'Sdelka yaratildi', `"${deal.productName}" sdelkasi yaratildi`)
    
    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_created', dealId: deal.id, deal });
    
    // ── WAREHOUSE STOCK DECREMENT (On Creation) ──
    try {
      const NON_SHIP_KEYWORDS = ['yangi', 'muzokara', 'peregovor', 'pereg', 'taklif', 'kutish', 'qayta aloqa', 'negativ', 'rad', 'otkaz', 'lost', 'fail', "yo'qotilgan"];
      function isShippingStage(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        return !NON_SHIP_KEYWORDS.some(kw => lower.includes(kw));
      }
      const newStageName = deal.stage?.name || '';
      const isShipping = isShippingStage(newStageName);
      
      if (isShipping && deal.warehouse && !deal.stockDecremented) {
        const itemColor = deal.productColor || 'oddiy';
        // Decrement stock
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor } },
          update: { stock: { decrement: 1 } },
          create: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, stock: -1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, changeQty: -1, action: 'ship', dealId: deal.id, notes: 'Sdelka #' + deal.id + ' — sotuv (yaratilganda)', userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
        await prisma.deal.update({ where: { id: deal.id }, data: { stockDecremented: true } });
        deal.stockDecremented = true;
      }
    } catch(stockErr) { console.error('[Stock decrement on create]', stockErr); }

    res.status(201).json(deal)
  } catch (error) { next(error) }
})

// Claim a deal
router.post('/:id/claim', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.deal.findUnique({ where: { id: Number(req.params.id) }, include: { stage: true } })
      if (!existing) throw new Error('NOT_FOUND')

      // Only allow claiming if it has no manager OR it's in a stage named "Yangi"
      const isNewStage = existing.stage && existing.stage.name.toLowerCase().includes('yangi')
      if (existing.managerId === null || isNewStage) {
        const result = await tx.deal.update({
          where: { id: Number(req.params.id) },
          data: { managerId: req.userId }
        })
        await tx.activityLog.create({
          data: {
            action: 'Sdelka o\'zlashtirildi',
            details: `Sdelka menejerga biriktirildi`,
            dealId: result.id,
            userId: req.userId
          }
        })
        return result
      }
      throw new Error('ALREADY_CLAIMED')
    })
    
    return res.json(updated)
  } catch (error) { 
    if (error.message === 'NOT_FOUND') return res.status(404).json({ message: 'Sdelka topilmadi' })
    if (error.message === 'ALREADY_CLAIMED') return res.status(400).json({ message: 'Bu sdelka allaqachon boshqa menejerga tegishli' })
    next(error) 
  }
})

// Bulk update deal stage and/or status
router.patch('/bulk/stage', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { ids, stageId, status } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Sdelkalar ro'yxati noto'g'ri" });
    }

    const numericIds = ids.map(Number).filter(id => !isNaN(id) && id > 0);
    if (numericIds.length === 0) {
      return res.status(400).json({ message: "Sdelkalar ID ro'yxati bo'sh" });
    }

    let targetStageId = null;
    let targetStatus = status || null;
    let targetStage = null;

    if (stageId !== null && stageId !== undefined && stageId !== '') {
      targetStageId = Number(stageId);
      targetStage = await prisma.pipelineStage.findUnique({ where: { id: targetStageId } });
      if (!targetStage) {
        return res.status(400).json({ message: "Bosqich topilmadi" });
      }

      const stageName = targetStage.name.toLowerCase();
      if (stageName.includes('yutil') || stageName.includes('100%') || stageName.includes('olindi')) {
        targetStatus = 'won';
      } else if (stageName.includes('rad') || stageName.includes('otkaz') || stageName.includes('lost') || stageName.includes('negativ') || stageName.includes('yo\'qotilgan')) {
        targetStatus = 'lost';
      } else {
        targetStatus = 'new';
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const dealsToUpdate = await tx.deal.findMany({
        where: { id: { in: numericIds } }
      });

      const allowedDeals = req.user?.role === 'admin'
        ? dealsToUpdate
        : dealsToUpdate.filter(d => d.managerId === null || d.managerId === req.userId);

      const allowedIds = allowedDeals.map(d => d.id);

      if (allowedIds.length === 0) {
        throw new Error("RUXSAT_YOQ");
      }

      const updateData = {};
      if (targetStageId !== null) updateData.stageId = targetStageId;
      if (targetStatus !== null) updateData.status = targetStatus;

      await tx.deal.updateMany({
        where: { id: { in: allowedIds } },
        data: updateData
      });

      for (const deal of allowedDeals) {
        let details = '';
        if (targetStage) {
          const prevName = deal.stageId ? 'avvalgi bosqich' : 'bosqichsiz';
          details = `Ommaviy ravishda bosqich o'zgartirildi: ${prevName} → ${targetStage.name}`;
        } else if (targetStatus) {
          details = `Ommaviy ravishda status o'zgartirildi: ${deal.status} → ${targetStatus}`;
        }

        await tx.activityLog.create({
          data: {
            action: "Ommaviy yangilash",
            details,
            dealId: deal.id,
            userId: req.userId
          }
        });

        // ── WAREHOUSE STOCK DECREMENT / ROLLBACK (Bulk execution) ──
        try {
          const NON_SHIP_KEYWORDS = ['yangi', 'muzokara', 'peregovor', 'pereg', 'taklif', 'kutish', 'qayta aloqa', 'negativ', 'rad', 'otkaz', 'lost', 'fail', "yo'qotilgan"];
          const isShippingStage = (name) => {
            if (!name) return false;
            const lower = name.toLowerCase();
            return !NON_SHIP_KEYWORDS.some(kw => lower.includes(kw));
          };

          const newStageName = targetStage?.name || '';
          const isShipping = isShippingStage(newStageName);

          if (isShipping && deal.warehouse && !deal.stockDecremented) {
            const itemColor = deal.productColor || 'oddiy';
            await tx.warehouseStock.upsert({
              where: { warehouse_productName_color: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor } },
              update: { stock: { decrement: 1 } },
              create: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, stock: -1 }
            });
            await tx.warehouseLog.create({
              data: {
                warehouse: deal.warehouse,
                productName: deal.productName,
                color: itemColor,
                changeQty: -1,
                action: 'ship',
                dealId: deal.id,
                notes: 'Sdelka #' + deal.id + ' — sotuv (ommaviy)',
                userName: req.user?.fullName || req.session?.user?.fullName || null
              }
            });
            await tx.deal.update({ where: { id: deal.id }, data: { stockDecremented: true } });
          } else if (!isShipping && deal.stockDecremented && deal.warehouse) {
            const itemColor = deal.productColor || 'oddiy';
            await tx.warehouseStock.upsert({
              where: { warehouse_productName_color: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor } },
              update: { stock: { increment: 1 } },
              create: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, stock: 1 }
            });
            await tx.warehouseLog.create({
              data: {
                warehouse: deal.warehouse,
                productName: deal.productName,
                color: itemColor,
                changeQty: 1,
                action: 'return',
                dealId: deal.id,
                notes: 'Sdelka #' + deal.id + ' — qaytarildi (ommaviy)',
                userName: req.user?.fullName || req.session?.user?.fullName || null
              }
            });
            await tx.deal.update({ where: { id: deal.id }, data: { stockDecremented: false } });
          }
        } catch (stockErr) {
          console.error('[Bulk stock update error]', stockErr);
        }
      }

      const finalDeals = await tx.deal.findMany({
        where: { id: { in: allowedIds } },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true } },
          manager: managerSelect,
          stage: stageSelect
        }
      });

      return { finalDeals, totalUpdated: allowedIds.length, skipped: numericIds.length - allowedIds.length };
    });

    const broadcast = req.app.get('broadcast');
    if (broadcast && result.finalDeals) {
      for (const d of result.finalDeals) {
        broadcast({ type: 'deal_updated', dealId: d.id, deal: d });
      }
    }

    res.json({
      message: `${result.totalUpdated} ta sdelka muvaffaqiyatli ko'chirildi.`,
      updatedCount: result.totalUpdated,
      skippedCount: result.skipped
    });

  } catch (error) {
    if (error.message === "RUXSAT_YOQ") {
      return res.status(403).json({ message: "Tanlangan sdelkalarni o'zgartirish ruxsati sizda yo'q" });
    }
    next(error);
  }
});

// Update deal
    const valError = await validateMandatoryFields(req, req.body, true);
    if (valError) return res.status(400).json({ message: valError });

    const {
      productName, amount, paidAmount, status, notes, clientId, deadline, managerId, stageId, costPrice, deliveryPrice,
      contactName, contactPhone, city, createdAt, warehouse, productColor, driverPhone, tags
    } = req.body

    const existing = await prisma.deal.findUnique({ where: { id: Number(req.params.id) } })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    if (req.user?.role !== 'admin' && existing.managerId !== null && existing.managerId !== req.userId) {
      return res.status(403).json({ message: "Boshqa menejer sdelkasini o'zgartira olmaysiz" })
    }

    let resolvedClientId = clientId !== undefined ? (clientId ? Number(clientId) : null) : existing.clientId;

    if (!resolvedClientId) {
      const hasQuickAddFields = [contactName, contactPhone, city, req.body.companyName, req.body.companyAddress, req.body.companyPhone, req.body.companyEmail, req.body.companyWebsite]
        .some(v => v !== undefined && v !== null && String(v).trim() !== '')

      if (hasQuickAddFields) {
        const newClient = await prisma.client.create({
          data: {
            name: (contactName && contactName.trim()) || req.body.companyName || "Noma'lum mijoz",
            phone: contactPhone || null,
            city: city || null,
            company: req.body.companyName || null,
            companyAddress: req.body.companyAddress || null,
            companyPhone: req.body.companyPhone || null,
            companyEmail: req.body.companyEmail || null,
            companyWebsite: req.body.companyWebsite || null,
            ownerId: req.userId
          }
        });
        resolvedClientId = newClient.id;
      }
    } else {
      // Update existing client
      const clientUpdateData = {};
      if (contactName !== undefined && contactName !== null) clientUpdateData.name = contactName.trim();
      if (contactPhone !== undefined && contactPhone !== null) clientUpdateData.phone = contactPhone.trim();
      if (city !== undefined && city !== null) clientUpdateData.city = city.trim();
      if (req.body.companyPhone !== undefined) clientUpdateData.companyPhone = req.body.companyPhone;
      if (req.body.companyEmail !== undefined) clientUpdateData.companyEmail = req.body.companyEmail;
      if (req.body.companyWebsite !== undefined) clientUpdateData.companyWebsite = req.body.companyWebsite;
      if (req.body.companyName !== undefined) clientUpdateData.company = req.body.companyName;
      if (req.body.companyAddress !== undefined) clientUpdateData.companyAddress = req.body.companyAddress;
      if (req.body.contactEmail !== undefined) clientUpdateData.email = req.body.contactEmail;

      if (Object.keys(clientUpdateData).length > 0) {
        await prisma.client.update({
          where: { id: resolvedClientId },
          data: clientUpdateData
        });
      }
    }

    const data = {}
    if (productName !== undefined) data.productName = productName
    if (amount !== undefined) data.amount = Number(amount)
    if (paidAmount !== undefined) data.paidAmount = Number(paidAmount)
    if (costPrice !== undefined) data.costPrice = Number(costPrice) || 0
    if (deliveryPrice !== undefined) data.deliveryPrice = Number(deliveryPrice) || 0
    if (status !== undefined) data.status = status
    if (notes !== undefined) data.notes = notes
    if (resolvedClientId !== undefined) data.clientId = resolvedClientId
    if (deadline !== undefined) data.deadline = (deadline && !isNaN(new Date(deadline))) ? new Date(deadline) : null
    if (createdAt !== undefined) {
      data.createdAt = (createdAt && !isNaN(new Date(createdAt))) ? new Date(createdAt) : new Date();
    }
    if (tags !== undefined) data.tags = tags;
    if (managerId !== undefined) {
      data.managerId = managerId ? Number(managerId) : null
    } else if (existing.managerId === null) {
      // Boshqa tahrirlash jarayonida ham bo'sh sdelka o'zlashtiriladi
      data.managerId = req.userId
    }
    if (stageId !== undefined) {
      data.stageId = stageId ? Number(stageId) : null
      if (stageId) {
        if (Number(stageId) !== existing.stageId) {
          data.stageUpdatedAt = new Date();
        }
        const stage = await prisma.pipelineStage.findUnique({ where: { id: Number(stageId) } })
        if (stage) {
          if (stage.statusType === 'won') {
            data.status = 'won';
          } else if (stage.statusType === 'lost') {
            data.status = 'lost';
          } else {
            const stageName = stage.name.toLowerCase();
            if (stageName.includes('yutil') || stageName.includes('100%') || stageName.includes('olindi')) {
              data.status = 'won';
            } else if (stageName.includes('rad') || stageName.includes('otkaz') || stageName.includes('lost')) {
              data.status = 'lost';
            } else {
              data.status = 'new';
            }
          }
        }
      }
    }
    if (warehouse !== undefined) data.warehouse = warehouse || null
    if (productColor !== undefined) data.productColor = productColor
    if (driverPhone !== undefined) data.driverPhone = driverPhone || null

    const deal = await prisma.deal.update({
      where: { id: Number(req.params.id) },
      data,
      include: {
        client: { select: { id: true, name: true, company: true, phone: true, city: true, companyPhone: true, companyEmail: true, companyWebsite: true, companyAddress: true, email: true } },
        manager: managerSelect,
        stage: stageSelect
      }
    })

    // Automation: Qayta aloqa yoki Vazifa
    if (deal.stage && (deal.stage.name.toLowerCase().includes('qayta aloqa') || deal.stage.name.toLowerCase().includes('vazifa'))) {
      // Dublikat yaratmaslik: shu deal uchun bajarilmagan vazifa bormi tekshirish
      const existingTask = await prisma.task.findFirst({
        where: { dealId: deal.id, completed: false }
      });
      const targetDate = deal.deadline ? new Date(deal.deadline) : new Date();
      const taskDescription = deal.notes || "Avtomatik yaratilgan vazifa: Mijoz bilan kelishilgan ishlarni bajarish";
      if (!existingTask) {
        await prisma.task.create({
          data: {
            title: (deal.productName || 'Sdelka') + " bo'yicha vazifa",
            description: taskDescription,
            dueDate: targetDate,
            dueTime: '10:00',
            dealId: deal.id,
            clientId: deal.clientId,
            assignedToId: req.userId
          }
        });
      } else {
        await prisma.task.update({
          where: { id: existingTask.id },
          data: {
            description: taskDescription,
            dueDate: targetDate
          }
        });
      }
    } else {
      // Boshqa bosqichga o'tkazilganda bajarilmagan vazifalarni yakunlash (qayta aloqa yopildi)
      await prisma.task.updateMany({
        where: { dealId: deal.id, completed: false },
        data: { completed: true }
      });
    }

    const statusLabels = { new: 'Yangi', negotiation: 'Muzokaralar', proposal: 'Taklif', won: 'Yutilgan', lost: "Yo'qotilgan" }
    if (status && status !== existing.status) {
      await logActivity(deal.id, req.userId, "Status o'zgartirildi",
        `${statusLabels[existing.status] || existing.status} → ${statusLabels[status] || status}`)
    } else if (Object.keys(data).length > 0) {
      await logActivity(deal.id, req.userId, 'Sdelka yangilandi', Object.keys(data).join(', ') + " o'zgartirildi")
    }

    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_updated', dealId: deal.id, deal });

    // ── WAREHOUSE STOCK DECREMENT / ROLLBACK ──
    try {
      const NON_SHIP_KEYWORDS = ['yangi', 'muzokara', 'peregovor', 'pereg', 'taklif', 'kutish', 'qayta aloqa', 'negativ', 'rad', 'otkaz', 'lost', 'fail', "yo'qotilgan"];
      function isShippingStage(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        return !NON_SHIP_KEYWORDS.some(kw => lower.includes(kw));
      }
      const newStageName = deal.stage?.name || '';
      const isShipping = isShippingStage(newStageName);
      
      if (isShipping && deal.warehouse && !deal.stockDecremented) {
        const itemColor = deal.productColor || 'oddiy';
        // Decrement stock
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor } },
          update: { stock: { decrement: 1 } },
          create: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, stock: -1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, changeQty: -1, action: 'ship', dealId: deal.id, notes: 'Sdelka #' + deal.id + ' — sotuv', userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
        await prisma.deal.update({ where: { id: deal.id }, data: { stockDecremented: true } });
        deal.stockDecremented = true;
      } else if (!isShipping && existing.stockDecremented && existing.warehouse) {
        const itemColor = existing.productColor || 'oddiy';
        // Rollback: deal moved back to non-shipping stage
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor } },
          update: { stock: { increment: 1 } },
          create: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, stock: 1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, changeQty: 1, action: 'return', dealId: deal.id, notes: 'Sdelka #' + deal.id + ' — qaytarildi', userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
        await prisma.deal.update({ where: { id: deal.id }, data: { stockDecremented: false } });
        deal.stockDecremented = false;
      }
    } catch(stockErr) { console.error('[Stock decrement]', stockErr); }

    res.json(deal)
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka topilmadi' })
    next(error)
  }
})

// Move deal to another stage (dedicated endpoint for Kanban drag-and-drop).
// Strict validation + atomic transaction: if the activity-log write fails,
// the stage change is rolled back automatically by Prisma's $transaction —
// the deal never ends up "half moved".
router.patch('/:id/stage', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Noto'g'ri sdelka ID" })
    }

    const { stageId } = req.body
    let newStageId = null
    if (stageId !== null && stageId !== undefined && stageId !== '') {
      newStageId = Number(stageId)
      if (!Number.isInteger(newStageId) || newStageId <= 0) {
        return res.status(400).json({ message: "Noto'g'ri bosqich ID" })
      }
    }

    const existing = await prisma.deal.findUnique({
      where: { id },
      include: { stage: stageSelect }
    })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    // Dastlabki tekshiruv (bu qism tranzaksiyadan tashqarida, tezkor xatolik berish uchun)
    if (req.user?.role !== 'admin' && existing.managerId !== null && existing.managerId !== req.userId) {
      return res.status(403).json({ message: "Boshqa menejer sdelkasini o'zgartira olmaysiz" })
    }

    let newStage = null
    if (newStageId !== null) {
      newStage = await prisma.pipelineStage.findUnique({ where: { id: newStageId } })
      if (!newStage) return res.status(400).json({ message: 'Bosqich topilmadi' })
    }

    // No-op: already in the requested stage — return as-is, nothing to roll back.
    if (existing.stageId === newStageId) {
      const unchanged = await prisma.deal.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true } },
          manager: managerSelect,
          stage: stageSelect
        }
      })
      return res.json(unchanged)
    }

    const deal = await prisma.$transaction(async (tx) => {
        // RACE CONDITION ni oldini olish: sdelka holatini tranzaksiya ichida qayta o'qiymiz
        const txDeal = await tx.deal.findUnique({ where: { id } })
        if (!txDeal) throw new Error("Sdelka topilmadi")
        if (req.user?.role !== 'admin' && txDeal.managerId !== null && txDeal.managerId !== req.userId) {
          throw new Error("Sdelkani allaqachon boshqa menejer o'zlashtirgan")
        }

        let finalStageId = newStageId;
        let finalPipelineId = txDeal.pipelineId;
        
        // Automation: Nasiya
        if (newStage && newStage.name.toLowerCase().includes('nasiya')) {
          const allPipelines = await tx.pipeline.findMany({ include: { stages: { orderBy: { order: 'asc' } } } });
          const nasiyaPipeline = allPipelines.find(p => p.name.toLowerCase().includes('nasiya'));
          if (nasiyaPipeline && nasiyaPipeline.stages.length > 0 && nasiyaPipeline.id !== txDeal.pipelineId) {
            finalStageId = nasiyaPipeline.stages[0].id;
            finalPipelineId = nasiyaPipeline.id;
          }
        }

        let finalManagerId = txDeal.managerId;
        if (!finalManagerId) {
          finalManagerId = req.userId;
        }

        let finalStatus = txDeal.status;
        if (newStage) {
          if (newStage.statusType === 'won') {
            finalStatus = 'won';
          } else if (newStage.statusType === 'lost') {
            finalStatus = 'lost';
          } else {
            const stageName = newStage.name.toLowerCase();
            if (stageName.includes('yutil') || stageName.includes('100%') || stageName.includes('olindi')) {
              finalStatus = 'won';
            } else if (stageName.includes('rad') || stageName.includes('otkaz') || stageName.includes('lost')) {
              finalStatus = 'lost';
            } else {
              finalStatus = 'new';
            }
          }
        }

      const updated = await tx.deal.update({
        where: { id },
        data: { stageId: finalStageId, pipelineId: finalPipelineId, managerId: finalManagerId, status: finalStatus, stageUpdatedAt: new Date() },
        include: {
          client: { select: { id: true, name: true, company: true, phone: true, city: true, companyPhone: true, companyEmail: true, companyWebsite: true, companyAddress: true, email: true } },
          manager: managerSelect,
          stage: stageSelect
        }
      })

      // Automatically complete all active tasks associated with this deal
      await tx.task.updateMany({
        where: { dealId: id, completed: false },
        data: { completed: true }
      })

      await tx.activityLog.create({
        data: {
          action: "Bosqich o'zgartirildi",
          details: `${existing.stage?.name || 'Bosqichsiz'} → ${updated.stage?.name || 'Bosqichsiz'}`,
          dealId: id,
          userId: req.userId
        }
      })

      // Automation: Qayta aloqa yoki Vazifa
      if (updated.stage && (updated.stage.name.toLowerCase().includes('qayta aloqa') || updated.stage.name.toLowerCase().includes('vazifa'))) {
        // Dublikat yaratmaslik: shu deal uchun bajarilmagan vazifa bormi tekshirish
        const existingTask = await tx.task.findFirst({
          where: { dealId: id, completed: false }
        });
        const targetDate = updated.deadline ? new Date(updated.deadline) : new Date();
        const taskDescription = updated.notes || "Avtomatik yaratilgan vazifa: Mijoz bilan kelishilgan ishlarni bajarish";
        if (!existingTask) {
          await tx.task.create({
            data: {
              title: (updated.productName || 'Sdelka') + " bo'yicha vazifa",
              description: taskDescription,
              dueDate: targetDate,
              dueTime: '10:00',
              dealId: id,
              clientId: updated.clientId,
              assignedToId: req.userId
            }
          });
        } else {
          await tx.task.update({
            where: { id: existingTask.id },
            data: {
              description: taskDescription,
              dueDate: targetDate
            }
          });
        }
      } else {
        // Boshqa bosqichga o'tkazilganda bajarilmagan vazifalarni yakunlash (qayta aloqa yopildi)
        await tx.task.updateMany({
          where: { dealId: id, completed: false },
          data: { completed: true }
        });
      }

      return updated
    })
    // Transaction muvaffaqiyatli bo'lgandan KEYIN broadcast (rollback da yolg'on event chiqmasligi uchun)
    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_updated', dealId: deal.id, deal });
    // ── WAREHOUSE STOCK DECREMENT / ROLLBACK (Stage change) ──
    try {
      const NON_SHIP_KEYWORDS = ['yangi', 'muzokara', 'peregovor', 'pereg', 'taklif', 'kutish', 'qayta aloqa', 'negativ', 'rad', 'otkaz', 'lost', 'fail', "yo'qotilgan"];
      function isShipStage(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        return !NON_SHIP_KEYWORDS.some(kw => lower.includes(kw));
      }
      const newStageName = deal.stage?.name || '';
      const isShip = isShipStage(newStageName);

      if (isShip && deal.warehouse && !existing.stockDecremented) {
        const itemColor = deal.productColor || 'oddiy';
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor } },
          update: { stock: { decrement: 1 } },
          create: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, stock: -1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: deal.warehouse, productName: deal.productName, color: itemColor, changeQty: -1, action: 'ship', dealId: deal.id, notes: 'Sdelka #' + deal.id + ' — bosqich o\'zgardi', userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
        await prisma.deal.update({ where: { id: deal.id }, data: { stockDecremented: true } });
        deal.stockDecremented = true;
      } else if (!isShip && existing.stockDecremented && existing.warehouse) {
        const itemColor = existing.productColor || 'oddiy';
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor } },
          update: { stock: { increment: 1 } },
          create: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, stock: 1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, changeQty: 1, action: 'return', dealId: deal.id, notes: 'Sdelka #' + deal.id + ' — qaytarildi', userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
        await prisma.deal.update({ where: { id: deal.id }, data: { stockDecremented: false } });
        deal.stockDecremented = false;
      }
    } catch(stockErr) { console.error('[Stock stage-change]', stockErr); }

    res.json(deal)
  } catch (error) {
    if (error.message === "Sdelkani allaqachon boshqa menejer o'zlashtirgan") {
      return res.status(403).json({ message: error.message })
    }
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka yoki bosqich topilmadi' })
    next(error)
  }
})

// Delete deal
router.delete('/:id', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const existing = await prisma.deal.findUnique({ where: { id: Number(req.params.id) } })
    if (!existing) return res.status(404).json({ message: 'Sdelka topilmadi' })

    if (req.user?.role !== 'admin' && existing.managerId !== null && existing.managerId !== req.userId) {
      return res.status(403).json({ message: "Boshqa menejer sdelkasini o'chira olmaysiz" })
    }

    // Warehouse stock rollback on delete
    if (existing.stockDecremented && existing.warehouse) {
      try {
        const itemColor = existing.productColor || 'oddiy';
        await prisma.warehouseStock.upsert({
          where: { warehouse_productName_color: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor } },
          update: { stock: { increment: 1 } },
          create: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, stock: 1 }
        });
        await prisma.warehouseLog.create({
          data: { warehouse: existing.warehouse, productName: existing.productName, color: itemColor, changeQty: 1, action: 'return', dealId: existing.id, notes: 'Sdelka #' + existing.id + " — o'chirildi, tovar qaytarildi", userName: req.user?.fullName || req.session?.user?.fullName || null }
        });
      } catch(stockErr) { console.error('[Stock delete-rollback]', stockErr); }
    }

    await prisma.$transaction([
      prisma.task.deleteMany({ where: { dealId: Number(req.params.id) } }),
      prisma.activityLog.deleteMany({ where: { dealId: Number(req.params.id) } }),
      prisma.deal.delete({ where: { id: Number(req.params.id) } })
    ])
    
    const broadcast = req.app.get('broadcast');
    if (broadcast) broadcast({ type: 'deal_deleted', dealId: Number(req.params.id) });
    
    res.json({ message: "Sdelka o'chirildi" })
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Sdelka topilmadi' })
    next(error)
  }
})

// Activity log
router.get('/:id/activity', async (req, res, next) => {
  try {
    const activities = await prisma.activityLog.findMany({
      where: { dealId: Number(req.params.id) },
      include: { user: managerSelect },
      orderBy: { createdAt: 'desc' }
    })
    res.json(activities)
  } catch (error) { next(error) }
})

router.post('/:id/activity', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { details } = req.body
    if (!details) return res.status(400).json({ message: 'Izoh mazmuni majburiy' })
    const activity = await prisma.activityLog.create({
      data: { action: "Izoh qo'shildi", details, dealId: Number(req.params.id), userId: req.userId },
      include: { user: managerSelect }
    })
    res.status(201).json(activity)
  } catch (error) { next(error) }
})

// Get installments
router.get('/:id/installments', async (req, res, next) => {
  try {
    const installments = await prisma.installment.findMany({
      where: { dealId: Number(req.params.id) },
      orderBy: { dueDate: 'asc' }
    });
    res.json(installments);
  } catch (error) { next(error); }
});

// Save/replace installments
router.post('/:id/installments', requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const dealId = Number(req.params.id);
    const { installments } = req.body;
    
    const result = await prisma.$transaction(async (tx) => {
      // Clear old installments and old auto-generated tasks
      await tx.installment.deleteMany({ where: { dealId } });
      await tx.task.deleteMany({
        where: {
          dealId,
          title: { startsWith: "To'lov eslatmasi" }
        }
      });
      
      const created = [];
      let totalAmount = 0;
      let totalPaid = 0;
      
      if (Array.isArray(installments)) {
        for (const inst of installments) {
          let dueDate = new Date(inst.dueDate);
          if (isNaN(dueDate.getTime())) {
            dueDate = new Date();
            // Defaulting to 1 month ahead if invalid date was passed
            dueDate.setMonth(dueDate.getMonth() + 1);
          }
          
          const instAmount = Number(inst.amount) || 0;
          const instPaid = Boolean(inst.paid);
          
          totalAmount += instAmount;
          if (instPaid) {
            totalPaid += instAmount;
          }
          
          const item = await tx.installment.create({
            data: {
              dealId,
              dueDate: dueDate,
              amount: instAmount,
              paid: instPaid,
              productName: inst.productName || null,
              month: inst.month || null,
              notes: inst.notes || null
            }
          });
          created.push(item);

          // 3 kun oldingi avtomatlashtirilgan eslatma yaratish (agar to'lanmagan bo'lsa)
          if (!instPaid) {
            const taskDueDate = new Date(dueDate);
            taskDueDate.setDate(taskDueDate.getDate() - 3);
            
            await tx.task.create({
              data: {
                title: `To'lov eslatmasi (Nasiya)`,
                description: `Ushbu sdelka uchun to'lov muddati: ${dueDate.toLocaleDateString('uz-UZ')}. To'lov summasi: ${instAmount} so'm. Mahsulot: ${inst.productName || 'Noma\'lum'}`,
                dueDate: taskDueDate,
                assignedToId: req.userId,
                dealId: dealId,
                priority: 'high'
              }
            });
          }
        }
      }
      
      // Update the deal's amount and paidAmount to match the installments
      if (created.length > 0) {
        const nasiyaStage = await tx.pipelineStage.findFirst({
          where: { name: 'Nasiya Desco' }
        });
        
        await tx.deal.update({
          where: { id: dealId },
          data: {
            amount: totalAmount,
            paidAmount: totalPaid,
            ...(nasiyaStage ? { stageId: nasiyaStage.id } : {})
          }
        });
      }
      
      return created;
    });
    res.json(result);
  } catch (error) { next(error); }
});

module.exports = router
