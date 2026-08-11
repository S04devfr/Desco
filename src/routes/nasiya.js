const express = require('express');
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.use(protect);

// GET /api/nasiya/stats — Nasiya Portfeli Statistikasi
router.get('/stats', async (req, res, next) => {
  try {
    const stages = await prisma.pipelineStage.findMany({
      where: { name: { contains: 'Nasiya', mode: 'insensitive' } },
      select: { id: true }
    });
    const stageIds = stages.map(s => s.id);

    const deals = await prisma.deal.findMany({
      where: { stageId: { in: stageIds } },
      include: { installments: true }
    });

    let totalPortfolio = 0;
    let totalPaid = 0;
    let overdueCount = 0;
    let overdueAmount = 0;
    let currentMonthTarget = 0;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    deals.forEach(d => {
      totalPortfolio += d.amount || 0;
      totalPaid += d.paidAmount || 0;

      (d.installments || []).forEach(inst => {
        const dt = new Date(inst.dueDate);
        if (!inst.paid && dt < now) {
          overdueCount++;
          overdueAmount += inst.amount || 0;
        }
        if (dt.getFullYear() === currentYear && dt.getMonth() === currentMonth) {
          currentMonthTarget += inst.amount || 0;
        }
      });
    });

    const totalRemaining = Math.max(0, totalPortfolio - totalPaid);

    res.json({
      totalPortfolio,
      totalPaid,
      totalRemaining,
      overdueCount,
      overdueAmount,
      currentMonthTarget,
      activeDealsCount: deals.length
    });
  } catch (error) {
    console.error('Nasiya stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/nasiya/record-payment — Rapid 1-Click Payment Record
router.post('/record-payment', async (req, res, next) => {
  try {
    const { installmentId, dealId, amount, paymentMethod = 'Naqd', notes = '' } = req.body;

    let updatedInst = null;
    let targetDealId = Number(dealId);

    if (installmentId) {
      updatedInst = await prisma.installment.update({
        where: { id: Number(installmentId) },
        data: { paid: true, notes: notes ? `${notes} (${paymentMethod})` : `To'landi (${paymentMethod})` }
      });
      targetDealId = updatedInst.dealId;
    }

    // Recalculate paidAmount of deal
    const allInsts = await prisma.installment.findMany({ where: { dealId: targetDealId } });
    const totalPaid = allInsts.filter(i => i.paid).reduce((s, i) => s + (i.amount || 0), 0);

    const updatedDeal = await prisma.deal.update({
      where: { id: targetDealId },
      data: { paidAmount: totalPaid },
      include: { client: true }
    });

    // Auto-complete matching task if any open
    const clientName = updatedDeal.client ? updatedDeal.client.name : '';
    const openTasks = await prisma.task.findMany({
      where: {
        completed: false,
        title: { contains: clientName || 'Nasiya' }
      }
    });

    for (const t of openTasks) {
      await prisma.task.update({
        where: { id: t.id },
        data: { completed: true, status: 'done' }
      });
    }

    // Log Activity
    await prisma.activityLog.create({
      data: {
        action: 'nasiya_payment',
        details: `Nasiya to'lovi qabul qilindi: ${Number(amount || (updatedInst ? updatedInst.amount : 0)).toLocaleString()} UZS (${paymentMethod}) — Mijoz: ${clientName}`,
        dealId: targetDealId,
        userId: req.userId
      }
    }).catch(() => {});

    res.json({ success: true, deal: updatedDeal, installment: updatedInst });
  } catch (error) {
    console.error('Record payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/nasiya/auto-generate-tasks — Auto-Generate Reminders & Tasks
router.post('/auto-generate-tasks', async (req, res, next) => {
  try {
    const stages = await prisma.pipelineStage.findMany({
      where: { name: { contains: 'Nasiya', mode: 'insensitive' } },
      select: { id: true }
    });
    const stageIds = stages.map(s => s.id);

    const deals = await prisma.deal.findMany({
      where: { stageId: { in: stageIds } },
      include: { client: true, installments: true }
    });

    const now = new Date();
    const upcomingLimit = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // within 7 days
    let generatedCount = 0;

    for (const deal of deals) {
      const client = deal.client || {};
      const unpaidInsts = (deal.installments || []).filter(i => !i.paid && new Date(i.dueDate) <= upcomingLimit);

      for (const inst of unpaidInsts) {
        const dt = new Date(inst.dueDate);
        const dateStr = dt.toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' });
        const titleText = `📞 Nasiya to'lovi: ${client.name || 'Mijoz'} (${client.phone || ''}) — ${(inst.amount || 0).toLocaleString()} UZS`;

        // Check if task already exists
        const existingTask = await prisma.task.findFirst({
          where: {
            title: { contains: client.name || 'Nasiya' },
            completed: false
          }
        });

        if (!existingTask) {
          await prisma.task.create({
            data: {
              title: titleText,
              description: `Nasiya to'lovi vaqti keldi (${dateStr}). Mahsulot: ${deal.productName || 'Nasiya'}. Summa: ${(inst.amount || 0).toLocaleString()} UZS.`,
              dueDate: dt,
              actionType: 'Связаться',
              priority: dt < now ? 'high' : 'medium',
              status: 'todo',
              assignedToId: deal.managerId || req.userId,
              createdById: req.userId,
              clientId: deal.clientId,
              dealId: deal.id
            }
          });
          generatedCount++;
        }
      }
    }

    res.json({ success: true, generatedCount });
  } catch (error) {
    console.error('Auto generate tasks error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/nasiya/list-deals?stage=...
router.get('/list-deals', async (req, res, next) => {
  try {
    const { stage } = req.query;
    if (!stage) return res.status(400).json({ message: 'Stage parametru majburiy' });

    // SQLite case-insensitive uchun LOWER() orqali qidiramiz
    const allStages = await prisma.pipelineStage.findMany({ select: { id: true, name: true } });
    const stageLow = stage.toLowerCase();
    const stages = allStages.filter(s => s.name.toLowerCase().includes(stageLow));

    const stageIds = stages.map(s => s.id);

    const deals = await prisma.deal.findMany({
      where: {
        stageId: { in: stageIds }
      },
      include: {
        client: true,
        manager: { select: { id: true, fullName: true, email: true } },
        stage: true,
        installments: { orderBy: { dueDate: 'asc' } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(deals);
  } catch (error) {
    console.error('Nasiya API xatosi:', error);
    return res.status(500).json([]);
  }
});

// POST /api/nasiya/quick-add
router.post('/quick-add', async (req, res, next) => {
  try {
    const { stage, clientName, clientPhone, productName, amount } = req.body;

    // Input validatsiya
    if (!stage || typeof stage !== 'string') return res.status(400).json({ message: 'Bosqich (stage) majburiy' });
    if (!clientName || !clientName.trim()) return res.status(400).json({ message: 'Mijoz ismi majburiy' });
    if (!clientPhone || !clientPhone.trim()) return res.status(400).json({ message: 'Mijoz telefoni majburiy' });

    // Find the stage
    const allSt = await prisma.pipelineStage.findMany({ select: { id: true, name: true, pipelineId: true } });
    const stageRecord = allSt.find(s => s.name.toLowerCase().includes(stage.toLowerCase()));
    
    if (!stageRecord) return res.status(400).json({ message: "Bosqich topilmadi" });

    // Find or create client
    let client = await prisma.client.findFirst({ where: { phone: clientPhone } });
    if (!client) {
      client = await prisma.client.create({
        data: { name: clientName, phone: clientPhone }
      });
    }

    // Create deal
    const deal = await prisma.deal.create({
      data: {
        productName: productName || 'Nasiya',
        amount: Number(amount) || 0,
        status: 'new',
        clientId: client.id,
        stageId: stageRecord.id,
        pipelineId: stageRecord.pipelineId,
        managerId: typeof req.userId === 'number' ? req.userId : null
      }
    });

    res.json(deal);
  } catch (error) {
    next(error);
  }
});

// GET /api/nasiya/excel-data
router.get('/excel-data', async (req, res, next) => {
  try {
    // Fetch all stages containing "Nasiya"
    const stages = await prisma.pipelineStage.findMany({
      where: {
        name: { contains: 'Nasiya' }
      },
      select: { id: true, name: true }
    });
    const stageIds = stages.map(s => s.id);

    // Fetch deals
    const deals = await prisma.deal.findMany({
      where: {
        stageId: { in: stageIds }
      },
      include: {
        client: true,
        manager: { select: { id: true, fullName: true } },
        installments: { orderBy: { dueDate: 'asc' } }
      },
      orderBy: { updatedAt: 'desc' }
    });

    // Build dynamic month columns
    const uniqueMonths = new Set();
    deals.forEach(deal => {
      deal.installments.forEach(inst => {
        const d = new Date(inst.dueDate);
        const year = d.getFullYear();
        const month = d.getMonth();
        const key = `${year}-${String(month + 1).padStart(2, '0')}`;
        uniqueMonths.add(key);
      });
    });

    const sortedMonthKeys = Array.from(uniqueMonths).sort();
    const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const months = sortedMonthKeys.map(key => {
      const [year, monthStr] = key.split('-');
      const monthIndex = parseInt(monthStr, 10) - 1;
      return {
        key,
        label: monthNames[monthIndex],
        fullLabel: `${monthNames[monthIndex]} ${year}`,
        year: parseInt(year, 10),
        month: monthIndex
      };
    });

    // Default months if no installments exist
    if (months.length === 0) {
      const currentYear = new Date().getFullYear();
      const defaultMonths = [4, 5, 6, 7, 8, 9, 10]; // May to Nov (0-indexed: 4 to 10)
      defaultMonths.forEach(m => {
        months.push({
          key: `${currentYear}-${String(m + 1).padStart(2, '0')}`,
          label: monthNames[m],
          fullLabel: `${monthNames[m]} ${currentYear}`,
          year: currentYear,
          month: m
        });
      });
    }

    res.json({ deals, months, stages });
  } catch (error) {
    console.error("Excel data fetch error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/nasiya/toggle-installment
router.post('/toggle-installment', async (req, res, next) => {
  try {
    const { installmentId, paid } = req.body;
    const instId = Number(installmentId);
    
    // Update installment
    const updatedInst = await prisma.installment.update({
      where: { id: instId },
      data: { paid: Boolean(paid) }
    });

    // Recalculate paidAmount of the deal
    const dealId = updatedInst.dealId;
    const allInsts = await prisma.installment.findMany({ where: { dealId } });
    const totalPaid = allInsts.filter(i => i.paid).reduce((sum, i) => sum + i.amount, 0);

    const updatedDeal = await prisma.deal.update({
      where: { id: dealId },
      data: { paidAmount: totalPaid }
    });

    res.json({ installment: updatedInst, deal: updatedDeal });
  } catch (error) {
    console.error("Toggle installment error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/nasiya/update-cell
router.post('/update-cell', async (req, res, next) => {
  try {
    const { dealId, field, value } = req.body;
    const dId = Number(dealId);

    const deal = await prisma.deal.findUnique({
      where: { id: dId },
      include: { client: true }
    });

    if (!deal) {
      return res.status(404).json({ error: "Deal not found" });
    }

    if (field === 'clientName') {
      if (deal.clientId) {
        await prisma.client.update({
          where: { id: deal.clientId },
          data: { name: String(value) }
        });
      }
    } else if (field === 'phone') {
      if (deal.clientId) {
        await prisma.client.update({
          where: { id: deal.clientId },
          data: { phone: String(value) }
        });
      }
    } else if (field === 'city') {
      if (deal.clientId) {
        await prisma.client.update({
          where: { id: deal.clientId },
          data: { city: String(value) }
        });
      }
    } else if (field === 'productName') {
      await prisma.deal.update({
        where: { id: dId },
        data: { productName: String(value) }
      });
    } else if (field === 'amount') {
      const valNum = parseFloat(value) || 0;
      await prisma.deal.update({
        where: { id: dId },
        data: { amount: valNum }
      });
    } else if (field === 'firstPayment') {
      const valNum = parseFloat(value) || 0;
      const firstInst = await prisma.installment.findFirst({
        where: { dealId: dId },
        orderBy: { dueDate: 'asc' }
      });
      if (firstInst) {
        await prisma.installment.update({
          where: { id: firstInst.id },
          data: { amount: valNum }
        });
        // Recalculate
        const allInsts = await prisma.installment.findMany({ where: { dealId: dId } });
        const totalAmount = allInsts.reduce((sum, i) => sum + i.amount, 0);
        const totalPaid = allInsts.filter(i => i.paid).reduce((sum, i) => sum + i.amount, 0);
        await prisma.deal.update({
          where: { id: dId },
          data: { amount: totalAmount, paidAmount: totalPaid }
        });
      }
    } else if (field === 'installmentAmount') {
      const valNum = parseFloat(value) || 0;
      const insts = await prisma.installment.findMany({
        where: { dealId: dId },
        orderBy: { dueDate: 'asc' }
      });
      if (insts.length > 1) {
        for (let i = 1; i < insts.length; i++) {
          await prisma.installment.update({
            where: { id: insts[i].id },
            data: { amount: valNum }
          });
        }
        // Recalculate
        const allInsts = await prisma.installment.findMany({ where: { dealId: dId } });
        const totalAmount = allInsts.reduce((sum, i) => sum + i.amount, 0);
        const totalPaid = allInsts.filter(i => i.paid).reduce((sum, i) => sum + i.amount, 0);
        await prisma.deal.update({
          where: { id: dId },
          data: { amount: totalAmount, paidAmount: totalPaid }
        });
      }
    } else {
      return res.status(400).json({ error: "Invalid field name" });
    }

    // Return the updated deal with installments and client
    const updated = await prisma.deal.findUnique({
      where: { id: dId },
      include: {
        client: true,
        manager: { select: { id: true, fullName: true } },
        installments: { orderBy: { dueDate: 'asc' } }
      }
    });

    res.json(updated);
  } catch (error) {
    console.error("Update cell error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/nasiya/excel-add
router.post('/excel-add', async (req, res, next) => {
  try {
    const {
      clientName,
      clientPhone,
      clientCity,
      productName,
      stageId,
      amount,
      firstPayment,
      months
    } = req.body;

    if (!clientName || !clientName.trim()) return res.status(400).json({ error: "Mijoz ismi majburiy" });
    if (!clientPhone || !clientPhone.trim()) return res.status(400).json({ error: "Telefon raqami majburiy" });
    if (!productName || !productName.trim()) return res.status(400).json({ error: "Mahsulot nomi majburiy" });
    if (!stageId) return res.status(400).json({ error: "Nasiya bosqichi majburiy" });

    const totalAmount = Number(amount) || 0;
    const downPayment = Number(firstPayment) || 0;
    const monthsCount = Number(months) || 1;

    // Find stage to get pipelineId
    const stage = await prisma.pipelineStage.findUnique({
      where: { id: Number(stageId) }
    });
    if (!stage) return res.status(400).json({ error: "Tanlangan bosqich topilmadi" });

    // Find or create client
    let client = await prisma.client.findFirst({
      where: { phone: clientPhone }
    });

    if (client) {
      // Update city if provided and empty
      if (clientCity && !client.city) {
        client = await prisma.client.update({
          where: { id: client.id },
          data: { city: clientCity }
        });
      }
    } else {
      client = await prisma.client.create({
        data: {
          name: clientName,
          phone: clientPhone,
          city: clientCity || null
        }
      });
    }

    // Run transaction to create deal and installments
    const deal = await prisma.$transaction(async (tx) => {
      const createdDeal = await tx.deal.create({
        data: {
          productName,
          amount: totalAmount,
          paidAmount: downPayment, // The first payment is considered paid
          status: 'won',
          clientId: client.id,
          stageId: stage.id,
          pipelineId: stage.pipelineId,
          managerId: req.userId
        }
      });

      const monthNames = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

      // 1. Create first installment (Down payment) - marked paid: true
      const now = new Date();
      await tx.installment.create({
        data: {
          dealId: createdDeal.id,
          dueDate: now,
          amount: downPayment,
          paid: true,
          productName,
          month: monthNames[now.getMonth()],
          notes: '1-chi To\'lov (Boshlang\'ich)'
        }
      });

      // 2. Generate remaining installments
      if (monthsCount > 1) {
        const remaining = totalAmount - downPayment;
        const monthlyAmt = Math.round(remaining / (monthsCount - 1));

        for (let i = 1; i < monthsCount; i++) {
          const dueDate = new Date();
          dueDate.setMonth(dueDate.getMonth() + i);

          // Adjust last payment for rounding errors
          const currentAmt = (i === monthsCount - 1)
            ? (remaining - (monthlyAmt * (monthsCount - 2)))
            : monthlyAmt;

          await tx.installment.create({
            data: {
              dealId: createdDeal.id,
              dueDate,
              amount: currentAmt,
              paid: false,
              productName,
              month: monthNames[dueDate.getMonth()],
              notes: `${i + 1}-oylik to'lov`
            }
          });
        }
      }

      return createdDeal;
    });

    // Return the new deal populated
    const result = await prisma.deal.findUnique({
      where: { id: deal.id },
      include: {
        client: true,
        manager: { select: { id: true, fullName: true } },
        installments: { orderBy: { dueDate: 'asc' } }
      }
    });

    res.json(result);
  } catch (error) {
    console.error("Excel add deal error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/nasiya/seed-real-debtors
router.post('/seed-real-debtors', async (req, res, next) => {
  try {
    const realDebtors = [
      { name: "Саида", phone: "+99897 705-25-60", date: "2026-01-16", amount: 3150000, city: "Коракалпогистон  Нукуз", manager: "Ko'rsatilmadi", notes: "Izohi: Mavjud emas (Menejer: Ko'rsatilmadi)" },
      { name: "Абдулазиз", phone: "+99890 387-20-01", date: "2026-02-04", amount: 200000, city: "Наманган", manager: "Ko'rsatilmadi", notes: "Бугун ташеди (3350000) | Qayta aloqa: 06.06.2026" },
      { name: "Гайрат", phone: "+99888 183-69-83", date: "2026-03-04", amount: 300000, city: "Сирдарё", manager: "Мираббос", notes: "Эртага беради | Qayta aloqa: 29.06.2026 (Menejer: Мираббос)" },
      { name: "Жизах", phone: "+99897 776-10-12", date: "2026-03-08", amount: 300000, city: "Жизах", manager: "Мираббос", notes: "Qayta aloqa: 29.06.2026 (Menejer: Мираббос)" },
      { name: "Андижон", phone: "+99894 783-44-11", date: "2026-03-10", amount: 1250000, city: "Андижон", manager: "Мираббос", notes: "Menejer: Мираббос" },
      { name: "Тошкент", phone: "+99897 011-11-47", date: "2026-03-27", amount: 1600000, city: "Пискент", manager: "Мираббос", notes: "Бугун беради | Qayta aloqa: 08.05.2026 (Menejer: Мираббос)" },
      { name: "Илхом ака Лочин", phone: "+99891 683-00-71", date: "2026-06-12", amount: 2800000, city: "Кукон", manager: "Мираббос", notes: "Ойлик олса беради 2 та олди | Qayta aloqa: 05.07.2026 (Menejer: Мираббос)" },
      { name: "Тошкент (776-97)", phone: "+99897 776-97-73", date: "2026-07-17", amount: 1200000, city: "Тошкент", manager: "Мираббос", notes: "Эски карздорлик (Menejer: Мираббос)" },
      { name: "Кашкадарё", phone: "+99891-561-19-46", date: "2026-07-17", amount: 3400000, city: "Кашкадарё", manager: "Мираббос", notes: "Эски карздорлик (Menejer: Мираббос)" },
      { name: "Тошкент (335-44)", phone: "95-335-44-33", date: "2026-07-28", amount: 400000, city: "Тошкент", manager: "Мираббос", notes: "Буйин массажёр олган (11250000) | Qayta aloqa: 08.08.2026 (Menejer: Мираббос)" },
      { name: "Тошкент (641-88)", phone: "+99895 641-88-48", date: "2026-06-02", amount: 50000, city: "Тошкент", manager: "Абдумалик", notes: "50 000 колди бугун беради | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Сирдарё", phone: "+99850-095-27-27", date: "2026-06-12", amount: 100000, city: "Сирдарё", manager: "Абдумалик", notes: "котармади кайта алока | Qayta aloqa: 01.08.2026 (Menejer: Абдумалик)" },
      { name: "Сурхандарё", phone: "+99833-799-09-11", date: "2026-07-01", amount: 1200000, city: "Сурхандарё", manager: "Абдумалик", notes: "Хар Жума 600 дан беради кайта алока тел очик | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Самарканд (151-11)", phone: "+99895-151-11-67", date: "2026-06-15", amount: 100000, city: "Самарканд", manager: "Абдумалик", notes: "1 800 000 дагавор булди 500 берди котармади кайта алока | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Жиззах", phone: "+99899-582-15-19", date: "2026-06-26", amount: 100000, city: "Жиззах", manager: "Абдумалик", notes: "1 700 000 дагавор 600 берди душанба беради | Qayta aloqa: 01.08.2026 (Menejer: Абдумалик)" },
      { name: "Тошкент (435-76)", phone: "+99893-435-76-73", date: "2026-06-26", amount: 1300000, city: "Тошкент", manager: "Абдумалик", notes: "Массажёр 6 ертага кечга котармади кайта алока | Qayta aloqa: 03.08.2026 (Menejer: Абдумалик)" },
      { name: "Тошкент (186-09)", phone: "+998931860922", date: "2026-07-09", amount: 400000, city: "Тошкент", manager: "Абдумаликк", notes: "1 600 000 Дагавор килинган кайта алока (3250000) | Qayta aloqa: 05.08.2026 (Menejer: Абдумаликк)" },
      { name: "Тошкент (262-97)", phone: "+99877-262-97-05", date: "2026-06-23", amount: 1800000, city: "Тошкент", manager: "Кодир", notes: "1 800 000 бериш керак кутармади 102 килинади | Qayta aloqa: 01.07.2026 (Menejer: Кодир)" },
      { name: "Наманган (0001-01)", phone: "94 0001 01 38", date: "2026-07-21", amount: 900000, city: "Наманган", manager: "Кодир", notes: "1.8 ертагаликга заказ 900 нахт колгани 20 кунда 900 | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Наманган (694-65)", phone: "90-694 65 62", date: "2026-07-20", amount: 1400000, city: "Наманган", manager: "Кодир", notes: "Хар 2 - 3 кунда 200 дан ташеди (200 берди 10.08) | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Кукон", phone: "90-586-57-74", date: "2026-07-25", amount: 600000, city: "Кукон", manager: "Кодир", notes: "600 клик А | Qayta aloqa: 10.08.2026 (Menejer: Кодир)" },
      { name: "Фаргона (537-21)", phone: "+99890 537-21-56", date: "2026-05-26", amount: 400000, city: "Фаргона", manager: "Кодирхон", notes: "Бугун беради уирилган кодирхон ака берадилар, клиент номерини очириб юборган | Qayta aloqa: 16.06.2025 (Menejer: Кодирхон)" },
      { name: "Фаргона (511-35)", phone: "+99855 511-35-16", date: "2026-05-26", amount: 950000, city: "Фаргога", manager: "Кодирхон", notes: "Ойлик олса беради душанба (6050000) | Qayta aloqa: 28.06.2026 (Menejer: Кодирхон)" },
      { name: "Тошкент (683-00)", phone: "91 683-00-71", date: "2026-07-25", amount: 400000, city: "Тошкент", manager: "Исмоилхо", notes: "Исмоилхон уртоги олган 1 400 барака 1 млн берган 400 колди | Qayta aloqa: 05.09.2026 (Menejer: Исмоилхо)" },
      { name: "Самарканд (386-07)", phone: "+99877-386-07-04", date: "2026-06-13", amount: 530000, city: "Самарканд", manager: "Аюбхон", notes: "1 800 000 келишдик 1 270 берди коганин 5-10 кунда беради очирилган | Qayta aloqa: 03.08.2026 (Menejer: Аюбхон)" },
      { name: "Такси Наманган", phone: "+99897-828-15-55", date: "2026-03-14", amount: 1250000, city: "Кукон", manager: "Мираббос", notes: "Бугун ташаб беради | Qayta aloqa: 04.05.2026 (Menejer: Мираббос)" },
      { name: "Такси Самарканд", phone: "+99850-511-66-99", date: "2026-06-02", amount: 1300000, city: "Самарканд", manager: "Абдумалик", notes: "Бугун ташаб беради | Qayta aloqa: 02.06.2026 (Menejer: Абдумалик)" },
      { name: "Такси Навойи", phone: "+99897-787-97-87", date: "2026-06-03", amount: 1640000, city: "Навойи", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 11.06.2026 (Menejer: Кодир)" },
      { name: "Такси Корапалпок", phone: "+99897-354-91-70", date: "2026-07-08", amount: 220000, city: "Корапалпок", manager: "Абдумалик", notes: "Бугун ташаб беради | Qayta aloqa: 17.06.2026 (Menejer: Абдумалик)" },
      { name: "Хоразм Шофёр", phone: "+99877-793-81-41", date: "2026-07-21", amount: 1300000, city: "Хоразм", manager: "Ko'rsatilmadi", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Ko'rsatilmadi)" },
      { name: "Самарканд Шофёр (766)", phone: "+99899-766-00-58", date: "2026-07-22", amount: 1350000, city: "Самарканд", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Кодир)" },
      { name: "Самарканд Шофёр (588)", phone: "+99899-588-90-09", date: "2026-07-29", amount: 1150000, city: "Самарканд", manager: "Кодир", notes: "Бугун ташаб беради | Qayta aloqa: 08.08.2026 (Menejer: Кодир)" }
    ];

    const inserted = [];
    for (let i = 0; i < realDebtors.length; i++) {
      const rd = realDebtors[i];
      const dDate = new Date(rd.date);

      let client = await prisma.client.findFirst({
        where: { name: rd.name, city: rd.city }
      });

      if (client) {
        client = await prisma.client.update({
          where: { id: client.id },
          data: {
            name: rd.name,
            phone: rd.phone,
            city: rd.city,
            debt: rd.amount,
            debtDate: dDate,
            debtNotes: rd.notes
          }
        });
      } else {
        client = await prisma.client.create({
          data: {
            name: rd.name,
            phone: rd.phone,
            city: rd.city,
            debt: rd.amount,
            debtDate: dDate,
            debtNotes: rd.notes
          }
        });
      }
      inserted.push(client);
    }

    res.json({ success: true, count: inserted.length, message: "32 ta haqiqiy qarzdorlar kiritildi" });
  } catch (error) {
    console.error("Seed real debtors error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
