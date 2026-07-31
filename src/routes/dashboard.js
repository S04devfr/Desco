const express = require('express')
const prisma = require('../config/database')
const { protect } = require('../middleware/auth')

const router = express.Router()
router.use(protect)

// Helper for dates
function buildWhere(filter, req) {
  if (!filter || filter === 'all') return {};
  const now = new Date();
  let start = new Date(now);
  let end = new Date(now);

  if (filter === 'today') {
    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);
  } else if (filter === 'yesterday') {
    start.setDate(start.getDate() - 1);
    start.setHours(0,0,0,0);
    end.setDate(end.getDate() - 1);
    end.setHours(23,59,59,999);
  } else if (filter === 'day-before-yesterday') {
    start.setDate(start.getDate() - 2);
    start.setHours(0,0,0,0);
    end.setDate(end.getDate() - 2);
    end.setHours(23,59,59,999);
  } else if (filter === 'range') {
    if (req && req.query.startDate && req.query.endDate) {
      start = new Date(req.query.startDate);
      start.setHours(0,0,0,0);
      end = new Date(req.query.endDate);
      end.setHours(23,59,59,999);
    } else {
      return {};
    }
  } else if (filter === 'month') {
    start.setDate(1);
    start.setHours(0,0,0,0);
    end.setHours(23,59,59,999);
  }

  // Validate dates to prevent Prisma crash
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {};
  }

  return {
    OR: [
      { createdAt: { gte: start, lte: end } },
      { updatedAt: { gte: start, lte: end } }
    ]
  };
}

// KPI metrics
router.get('/kpis', async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    
    // Operator sees only their own deals for KPIs
    if (!isAdmin) {
      where.managerId = req.userId;
    }
    
    const deals = await prisma.deal.findMany({ where, include: { stage: true, client: true, manager: { select: { id: true, fullName: true, email: true, role: true } } } });
    // Expenses only use createdAt
    const expenseWhere = where.OR ? { createdAt: { gte: where.OR[0].createdAt.gte, lte: where.OR[0].createdAt.lte } } : {};
    const expenses = await prisma.expense.findMany({ where: expenseWhere });

    const getEffectivePaid = (d) => {
      const stageName = (d.stage?.name || '').toLowerCase();
      const isWon = d.status === 'won' || 
                    stageName.includes('100%') || 
                    stageName.includes('yutil') || 
                    stageName.includes('won') ||
                    stageName.includes('olindi');
      return isWon ? (d.paidAmount || 0) : 0;
    };

    const isWonDeal = (d) => {
      const stageName = (d.stage?.name || '').toLowerCase();
      return d.status === 'won' || 
             stageName.includes('100%') || 
             stageName.includes('yutil') || 
             stageName.includes('won') ||
             stageName.includes('olindi');
    };

    const isDealCanceled = (d) => {
      if (d.status === 'lost') return true;
      const stageName = (d.stage?.name || '').toLowerCase();
      return stageName.includes('rad') || 
             stageName.includes('otkaz') || 
             stageName.includes('negativ') || 
             stageName.includes('qaytdi') ||
             stageName.includes('yo\'qotilgan') ||
             stageName.includes('lost');
    };

    const dlvPipeline = await prisma.pipeline.findFirst({
      where: { name: { contains: 'zakaz', mode: 'insensitive' } },
      select: { id: true }
    });
    const dlvPipelineId = dlvPipeline ? dlvPipeline.id : null;
    const dlvDeals = dlvPipelineId ? deals.filter(d => d.stage?.pipelineId === dlvPipelineId) : [];

    const totalOrders = dlvDeals.length;
    const totalLeads = dlvPipelineId ? deals.filter(d => d.stage?.pipelineId !== dlvPipelineId).length : deals.length;
    const totalRevenue = deals.reduce((sum, d) => sum + getEffectivePaid(d), 0);
    const totalDebt = deals.reduce((sum, d) => sum + Math.max((d.amount || 0) - (d.paidAmount || 0), 0), 0);
    
    let totalExpenses = 0, totalCostPrice = 0, netProfit = 0, totalClientDebt = 0;
    let totalMarketingExpenses = 0;
    let expenseByCategory = {};
    
    if (isAdmin) {
      totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      totalMarketingExpenses = expenses.filter(e => e.category === 'marketing').reduce((sum, e) => sum + e.amount, 0);
      // Kategoriyalar bo'yicha xarajat breakdown
      expenses.forEach(e => {
        const cat = e.category || 'other';
        expenseByCategory[cat] = (expenseByCategory[cat] || 0) + e.amount;
      });
      
      // Cost price faqat yopilgan (won) deals uchun hisoblanadi
      const wonDeals = deals.filter(isWonDeal);
      totalCostPrice = wonDeals.reduce((sum, d) => sum + (d.costPrice || 0), 0);
      
      netProfit = totalRevenue - totalCostPrice - totalExpenses;
      
      const clientsAgg = await prisma.client.aggregate({
        _sum: { debt: true },
        where: { debt: { gt: 0 } }
      });
      const manualDebt = clientsAgg._sum.debt || 0;

      let dealDebt = 0;
      try {
        const isPostgres = process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://'));
        if (isPostgres) {
          const res = await prisma.$queryRaw`SELECT SUM(COALESCE(amount, 0) - COALESCE("paidAmount", 0)) as "sum" FROM "Deal" WHERE amount > "paidAmount"`;
          dealDebt = Number(res[0]?.sum || 0);
        } else {
          const res = await prisma.$queryRaw`SELECT SUM(COALESCE(amount, 0) - COALESCE(paidAmount, 0)) as "sum" FROM "Deal" WHERE amount > paidAmount`;
          dealDebt = Number(res[0]?.sum || 0);
        }
      } catch (e) {
        const allDeals = await prisma.deal.findMany({ select: { amount: true, paidAmount: true } });
        dealDebt = allDeals.reduce((sum, d) => sum + Math.max((d.amount || 0) - (d.paidAmount || 0), 0), 0);
      }
      totalClientDebt = manualDebt + dealDebt;
    }

    const won = deals.filter(isWonDeal).length;
    const lost = deals.filter(isDealCanceled).length;

    // ── 1. Marketing Ads Spent, CPL, ROI ──
    // CPL uchun to'g'ri denominator: marketing log'laridan leads summasi
    const mktLeadsWhere = {}
    if (where.OR && where.OR.length) {
      const dr = where.OR[0]?.updatedAt || where.OR[0]?.createdAt
      if (dr) mktLeadsWhere.date = dr
    }
    let totalLeadsCreated = deals.length;
    try {
      const mktLeadsAgg = await prisma.marketingLog.aggregate({ _sum: { leads: true }, where: mktLeadsWhere });
      totalLeadsCreated = mktLeadsAgg._sum.leads || deals.length; // fallback to deals count
    } catch(e) {
      // Table might not exist yet
    }
    const cpl = totalLeadsCreated > 0 ? (totalMarketingExpenses / totalLeadsCreated) : 0;
    const marketingRoi = totalMarketingExpenses > 0 ? ((netProfit / totalMarketingExpenses) * 100) : 0;

    // ── 2. Cancellation (Otkaz) Metrics ──
    const canceledDeals = dlvDeals.filter(isDealCanceled);
    const totalCanceledCount = canceledDeals.length;
    const totalCanceledValue = canceledDeals.reduce((sum, d) => sum + (d.amount || 0), 0);
    const cancellationRate = totalOrders > 0 ? ((totalCanceledCount / totalOrders) * 100) : 0;

    // ── 3. Nasiya Tariffs Breakdown ──
    const getDebtBalance = (d) => Math.max(0, (d.amount || 0) - (d.paidAmount || 0));

    const countNasiyaDesco = deals.filter(d => d.stage?.name.toLowerCase().includes('desco')).length;
    const amountNasiyaDesco = deals.filter(d => d.stage?.name.toLowerCase().includes('desco')).reduce((sum, d) => sum + getDebtBalance(d), 0);
    
    const countNasiyaIshonch = deals.filter(d => d.stage?.name.toLowerCase().includes('ishonch')).length;
    const amountNasiyaIshonch = deals.filter(d => d.stage?.name.toLowerCase().includes('ishonch')).reduce((sum, d) => sum + getDebtBalance(d), 0);

    const countNasiyaBaraka = deals.filter(d => d.stage?.name.toLowerCase().includes('baraka')).length;
    const amountNasiyaBaraka = deals.filter(d => d.stage?.name.toLowerCase().includes('baraka')).reduce((sum, d) => sum + getDebtBalance(d), 0);

    const countShopir = deals.filter(d => d.stage?.name.toLowerCase().includes('shopir')).length;
    const amountShopir = deals.filter(d => d.stage?.name.toLowerCase().includes('shopir')).reduce((sum, d) => sum + getDebtBalance(d), 0);
    const shopirDeals = deals.filter(d => d.stage?.name.toLowerCase().includes('shopir')).map(d => ({
      id: d.id,
      productName: d.productName || 'Noma\'lum',
      amount: d.amount || 0,
      paidAmount: d.paidAmount || 0,
      debt: getDebtBalance(d),
      date: d.createdAt ? d.createdAt.toISOString().slice(0, 10) : '',
      managerName: d.manager?.fullName || '—'
    }));

    // ── 4. Geografik Tahlil (Sales by City) ──
    const cityMap = {};
    deals.forEach(d => {
      const city = d.client?.city || "Noma'lum";
      if (!cityMap[city]) {
        cityMap[city] = { count: 0, revenue: 0 };
      }
      cityMap[city].count += 1;
      cityMap[city].revenue += getEffectivePaid(d);
    });
    const geographicSales = Object.entries(cityMap)
      .map(([city, data]) => ({ city, count: data.count, revenue: data.revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // ── 5. Salesforce Pipeline Forecast ──
    let pipelineForecastValue = 0;
    deals.forEach(d => {
      const stageName = (d.stage?.name || '').toLowerCase();
      let probability = 0.1; // Default probability: 10%
      if (stageName.includes('yangi')) probability = 0.15;
      else if (stageName.includes('muzokara') || stageName.includes('peregovor') || stageName.includes('pereg')) probability = 0.35;
      else if (stageName.includes('taklif')) probability = 0.6;
      else if (stageName.includes('nasiya') || stageName.includes('shopir') || stageName.includes('yo\'lda')) probability = 0.85;
      else if (stageName.includes('100%') || stageName.includes('yutil') || d.status === 'won') probability = 1.0;
      else if (isDealCanceled(d)) probability = 0.0;

      const remainingToCollect = Math.max((d.amount || 0) - getEffectivePaid(d), 0);
      pipelineForecastValue += (remainingToCollect * probability);
    });

    // ── 6. Managers Detailed Performance KPIs ──
    const managerPerformance = {};
    deals.forEach(d => {
      if (!d.manager) return; // Skip unassigned ("Belgilanmagan")
      if (d.manager.role === 'admin') return; // Skip admin/developer like "Muhammadyusuf"

      const managerName = d.manager.fullName || d.manager.email || 'Menejer';
      const managerId = d.managerId;
      if (!managerPerformance[managerName]) {
        managerPerformance[managerName] = {
          id: managerId,
          name: managerName,
          totalCount: 0,
          wonCount: 0,
          wonValue: 0,
          canceledCount: 0
        };
      }
      managerPerformance[managerName].totalCount += 1;
      if (d.status === 'won' || (d.stage && (d.stage.name.toLowerCase().includes('100%') || d.stage.name.toLowerCase().includes('yutil')))) {
        managerPerformance[managerName].wonCount += 1;
        managerPerformance[managerName].wonValue += d.amount;
      }
      if (isDealCanceled(d)) {
        managerPerformance[managerName].canceledCount += 1;
      }
    });

    // ── Salary & Fines ──
    const currentMonth = new Date().toISOString().slice(0, 7);
    let allSalaries = [], allFines = [];
    try {
      allSalaries = await prisma.managerSalary.findMany();
      allFines = await prisma.managerFine.findMany({ where: { month: currentMonth } });
    } catch (_) { /* jadval hali yaratilmagan */ }

    const managersList = Object.values(managerPerformance).map(m => {
      const winRate = m.totalCount > 0 ? ((m.wonCount / m.totalCount) * 100) : 0;
      const avgCheck = m.wonCount > 0 ? (m.wonValue / m.wonCount) : 0;
      const salaryRecord = allSalaries.find(s => s.managerId === m.id);
      const baseSalary = salaryRecord?.baseSalary || 0;
      const mgrFines = allFines.filter(f => f.managerId === m.id);
      const totalFines = mgrFines.reduce((s, f) => s + f.amount, 0);
      const kpiBonus = m.wonCount * 100000;
      const totalSalary = baseSalary + kpiBonus - totalFines;
      return {
        ...m,
        winRate,
        avgCheck,
        baseSalary,
        kpiBonus,
        totalFines,
        fines: mgrFines,
        totalSalary
      };
    });

    // ── 7. Funnel conversion stages (HubSpot Funnel) ──
    const funnelStages = {
      yangi: deals.filter(d => d.stage?.name.toLowerCase().includes('yangi')).length,
      muzokara: deals.filter(d => {
        const name = (d.stage?.name || '').toLowerCase();
        return name.includes('muzokara') || name.includes('peregovor') || name.includes('pereg');
      }).length,
      lost: lost,
      total: deals.length
    };

    res.json({
      totalLeads,
      totalOrders,
      totalRevenue,
      totalDebt,
      totalExpenses,
      totalCostPrice,
      netProfit,
      totalClientDebt,
      won,
      lost,
      totalMarketingExpenses,
      expenseByCategory: expenseByCategory || {},
      cpl,
      marketingRoi,
      totalCanceledCount,
      totalCanceledValue,
      cancellationRate,
      nasiyaDesco: { count: countNasiyaDesco, amount: amountNasiyaDesco },
      nasiyaIshonch: { count: countNasiyaIshonch, amount: amountNasiyaIshonch },
      nasiyaBaraka: { count: countNasiyaBaraka, amount: amountNasiyaBaraka },
      shopir: { count: countShopir, amount: amountShopir, deals: shopirDeals },
      geographicSales,
      pipelineForecastValue,
      managersList,
      funnelStages
    });
  } catch (error) {
    console.error('KPI Error:', error);
    return res.status(200).json({
      totalLeads: 0,
      totalOrders: 0,
      totalRevenue: 0,
      totalDebt: 0,
      totalExpenses: 0,
      totalCostPrice: 0,
      netProfit: 0,
      totalClientDebt: 0,
      won: 0,
      lost: 0,
      totalMarketingExpenses: 0,
      cpl: 0,
      marketingRoi: 0,
      totalCanceledCount: 0,
      totalCanceledValue: 0,
      cancellationRate: 0,
      nasiyaDesco: { count: 0, amount: 0 },
      nasiyaIshonch: { count: 0, amount: 0 },
      nasiyaBaraka: { count: 0, amount: 0 },
      shopir: { count: 0, amount: 0 },
      geographicSales: [],
      pipelineForecastValue: 0,
      managersList: [],
      funnelStages: { yangi: 0, muzokara: 0, lost: 0, total: 0 },
      error: error.message + "\n" + error.stack
    });
  }
})

// Sales grouped by day for current month / range
router.get('/sales-by-manager', async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    if (!isAdmin) where.managerId = req.userId;

    const originalWhere = { ...where };
    const deals = await prisma.deal.findMany({
      where: originalWhere,
      select: {
        amount: true,
        paidAmount: true,
        status: true,
        createdAt: true,
        stage: { select: { name: true } }
      },
      orderBy: { createdAt: 'asc' }
    });

    let startDate = new Date();
    startDate.setDate(1);
    let endDate = new Date();

    if (req.query.filter === 'range' && req.query.startDate && req.query.endDate) {
      startDate = new Date(req.query.startDate);
      endDate = new Date(req.query.endDate);
    } else if (req.query.filter === 'week') {
      startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
      endDate = new Date();
    } else if (req.query.filter === 'yesterday') {
      startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      endDate = new Date();
    } else if (req.query.filter === 'today') {
      startDate = new Date();
      endDate = new Date();
    }

    const dailyData = {};
    const temp = new Date(startDate);
    temp.setHours(0, 0, 0, 0);
    const endMidnight = new Date(endDate);
    endMidnight.setHours(23, 59, 59, 999);

    while (temp <= endMidnight) {
      const dateStr = temp.toISOString().slice(0, 10);
      const dayLabel = temp.getDate();
      dailyData[dateStr] = { date: dateStr, day: dayLabel, sales: 0, debt: 0 };
      temp.setDate(temp.getDate() + 1);
    }

    for (const d of deals) {
      if (!d.createdAt) continue;
      const dateStr = new Date(d.createdAt).toISOString().slice(0, 10);
      if (dailyData[dateStr]) {
        const stageName = (d.stage?.name || '').toLowerCase();
        const isWon = d.status === 'won' || stageName.includes('100%') || stageName.includes('yutil') || stageName.includes('won');
        if (isWon) {
          dailyData[dateStr].sales += d.amount || 0;
          dailyData[dateStr].debt += Math.max(0, (d.amount || 0) - (d.paidAmount || 0));
        }
      }
    }

    res.json(Object.values(dailyData));
  } catch (error) {
    console.error('Sales Daily Error:', error);
    return res.status(200).json([]);
  }
})

// Product popularity
router.get('/product-popularity', async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    if (!isAdmin) where.managerId = req.userId;
    const deals = await prisma.deal.findMany({ where, select: { productName: true, amount: true } })

    const map = {}
    for (const d of deals) {
      const name = d.productName || 'Noma\'lum'
      if (!map[name]) map[name] = { count: 0, totalAmount: 0 }
      map[name].count++
      map[name].totalAmount += d.amount || 0
    }

    const totalAmount = Object.values(map).reduce((s, v) => s + v.totalAmount, 0)
    const result = Object.entries(map)
      .map(([product, v]) => ({
        product,
        count: v.count,
        totalAmount: v.totalAmount,
        pct: totalAmount > 0 ? Math.round((v.totalAmount / totalAmount) * 100) : 0
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    res.json(result)
  } catch (error) {
    console.error('Product Error:', error);
    return res.status(200).json([]);
  }
})

// Today's tasks
router.get('/today-tasks', async (req, res, next) => {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)

    const where = {
      completed: false,
      OR: [
        { dueDate: { gte: startOfDay, lte: endOfDay } },
        { dueDate: null }
      ]
    }
    if (req.user?.role !== 'admin') where.assignedToId = req.userId

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
        deal: {
          select: {
            id: true,
            productName: true,
            client: { select: { id: true, name: true, company: true, phone: true, city: true } }
          }
        },
        client: { select: { id: true, name: true, company: true, phone: true, city: true } }
      },
      orderBy: { dueDate: 'asc' }
    })
    
    const enriched = tasks.map(t => {
      const client = t.client || t.deal?.client || null;
      return {
        ...t,
        clientId: client ? client.id : null,
        client: client
      };
    });
    
    res.json(enriched)
  } catch (error) {
    console.error('Tasks Error:', error);
    return res.status(200).json([]);
  }
})

// ── Instagram leads stats ──
// ── Instagram leads stats ──
router.get('/instagram-stats', async (req, res) => {
  try {
    const where = buildWhere(req.query.filter, req);
    const msgWhere = {};
    let mktWhere = { channel: 'instagram' };
    if (where.OR && where.OR.length) {
      const dateRange = where.OR[0]?.updatedAt || where.OR[0]?.createdAt;
      if (dateRange) {
        msgWhere.timestamp = dateRange;
        mktWhere.date = dateRange;
      }
    }

    const clientWhere = { instagramId: { not: null } };
    if (where.OR && where.OR.length) {
      const dateRange = where.OR[0]?.updatedAt || where.OR[0]?.createdAt;
      if (dateRange) {
        clientWhere.createdAt = dateRange;
      }
    }

    const [totalMessages, incomingMessages, linkedClients, mktLogs, messages, clientsWithDeals, newClients] = await Promise.all([
      prisma.instagramMessage.count({ where: msgWhere }),
      prisma.instagramMessage.count({ where: { ...msgWhere, isOutgoing: false } }),
      prisma.client.count({ where: { instagramId: { not: null } } }),
      prisma.marketingLog.findMany({ where: mktWhere, select: { spent: true, leads: true } }),
      prisma.instagramMessage.findMany({
        where: msgWhere,
        orderBy: { timestamp: 'asc' },
        select: { text: true, senderId: true, recipientId: true, timestamp: true, clientId: true, isOutgoing: true }
      }),
      prisma.client.findMany({
        where: { instagramId: { not: null } },
        select: {
          id: true,
          deals: {
            select: {
              productName: true,
              amount: true,
              notes: true,
              status: true,
              stage: {
                select: { name: true }
              }
            }
          }
        }
      })
    ]);

    const igSpent = mktLogs.reduce((s, l) => s + (l.spent || 0), 0);
    const igLeads = mktLogs.reduce((s, l) => s + (l.leads || 0), 0);
    const igCpl = igLeads > 0 ? igSpent / igLeads : 0;

    // Advanced Text & Deal Analytics
    const dailyChatsMap = {};
    const dailyWritersMap = {};
    const clientMessages = {};

    messages.forEach(msg => {
      if (!msg.clientId) return;
      
      const date = new Date(msg.timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      if (!dailyChatsMap[dateStr]) {
        dailyChatsMap[dateStr] = new Set();
      }
      dailyChatsMap[dateStr].add(msg.clientId);

      // Yozgan yagona mijozlar (incoming messages only)
      if (!msg.isOutgoing) {
        if (!dailyWritersMap[dateStr]) {
          dailyWritersMap[dateStr] = new Set();
        }
        dailyWritersMap[dateStr].add(msg.clientId);
      }

      if (!msg.isOutgoing && msg.text) {
        if (!clientMessages[msg.clientId]) {
          clientMessages[msg.clientId] = [];
        }
        clientMessages[msg.clientId].push(msg.text.toLowerCase());
      }
    });

    const dailyActiveChats = Object.entries(dailyChatsMap).map(([date, clientsSet]) => ({
      date,
      count: clientsSet.size
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Ensure all active chat dates exist in dailyWritersMap for alignment
    Object.keys(dailyChatsMap).forEach(dateStr => {
      if (!dailyWritersMap[dateStr]) {
        dailyWritersMap[dateStr] = new Set();
      }
    });

    const dailyIncomingWriters = Object.entries(dailyWritersMap).map(([date, clientsSet]) => ({
      date,
      count: clientsSet.size
    })).sort((a, b) => a.date.localeCompare(b.date));

    const totalDays = dailyIncomingWriters.length;
    const totalWritersSum = dailyIncomingWriters.reduce((sum, item) => sum + item.count, 0);
    const averageWritersPerDay = totalDays > 0 ? Math.round(totalWritersSum / totalDays) : 0;

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const todayWritersCount = dailyWritersMap[todayStr] ? dailyWritersMap[todayStr].size : 0;

    let nasiyaCount = 0;
    let naqdCount = 0;
    let unspecifiedCount = 0;

    let count3Func = 0;
    let count6Func = 0;
    let countOyoq = 0;
    let countHadiya = 0;
    let countOtherProduct = 0;

    let purchaseCount = 0;
    let inquiryCount = 0;
    let otherCount = 0;

    let lostPriceCount = 0;
    let lostDeliveryCount = 0;
    let lostThinkingCount = 0;
    let lostLateResponseCount = 0;
    let lostOtherCount = 0;

    const isDealCanceled = (d) => {
      if (d.status === 'lost') return true;
      const stageName = (d.stage?.name || '').toLowerCase();
      return stageName.includes('rad') || 
             stageName.includes('otkaz') || 
             stageName.includes('negativ') || 
             stageName.includes('qaytdi') ||
             stageName.includes('yo\'qotilgan') ||
             stageName.includes('lost');
    };

    const sampleOpinions = [];

    if (Array.isArray(clientsWithDeals)) {
      clientsWithDeals.forEach(client => {
        const texts = clientMessages[client.id] || [];
        const combinedText = texts.join(' ');
        const deals = client.deals || [];

        // 1. Payment Preference (Nasiya vs Naqd)
        const hasNasiyaKeywords = /nasiya|muddatli|bo'lib|bolib|kredit|oyiga|oyma|ijara|variant|rassrochka|рассрочка|кредит|насия|булиб|бўлиб|ойига|oylik/i.test(combinedText);
        const hasNaqdKeywords = /naqd|naqt|click|payme|karta|plastik|terminal|bitta to'lov|naxt|dostavka payt|yetib borganda|kuryerga|cash|накт|нақд|клик|пейми|карта|пластик|курьерга|нақт/i.test(combinedText);
        
        const hasNasiyaDeal = deals.some(d => {
          const stageName = (d.stage?.name || '').toLowerCase();
          const notes = (d.notes || '').toLowerCase();
          const prodName = (d.productName || '').toLowerCase();
          return stageName.includes('nasiya') || stageName.includes('kredit') || /nasiya|muddatli|bo'lib|bolib|kredit|oyiga/i.test(notes) || /nasiya|muddatli|bo'lib|bolib|kredit/i.test(prodName);
        });
        const hasNaqdDeal = deals.some(d => {
          const stageName = (d.stage?.name || '').toLowerCase();
          const notes = (d.notes || '').toLowerCase();
          return stageName.includes('naqd') || stageName.includes('100%') || stageName.includes('click') || stageName.includes('payme') || /naqd|naqt|click|payme|karta|plastik/i.test(notes);
        });

        if (hasNasiyaDeal || hasNasiyaKeywords) {
          nasiyaCount++;
        } else if (hasNaqdDeal || hasNaqdKeywords) {
          naqdCount++;
        } else {
          unspecifiedCount++;
        }

        // 2. Product Interests
        const has6Func = /6-funksiyalik|6-funksiya|6 talik|6-talik|6 lik|6lik|6 ta|olti talik|6-ta|massajor 6|е6/i.test(combinedText) ||
                         deals.some(d => /6-funksiyalik|6-funksiya|6 talik|6-talik|6 lik|6lik|6 ta|olti talik|6-ta|massajor 6|е6/i.test(d.productName || ''));
        const has3Func = /3-funksiyalik|3-funkiyalik|3-funksiya|3 talik|3-talik|3 lik|3lik|3 ta|uch talik|3-ta/i.test(combinedText) ||
                         deals.some(d => /3-funksiyalik|3-funkiyalik|3-funksiya|3 talik|3-talik|3 lik|3lik|3 ta|uch talik|3-ta/i.test(d.productName || ''));
        const hasOyoq = /oyoq|nog|stup|tavon/i.test(combinedText) ||
                        deals.some(d => /oyoq|nog|stup|tavon/i.test(d.productName || ''));
        const hasHadiya = /hadiya|hadya|sovg'a|sovga|toplam|to'plam/i.test(combinedText) ||
                          deals.some(d => /hadiya|hadya|sovg'a|sovga|toplam|to'plam/i.test(d.productName || ''));

        let matched = false;
        if (has6Func) {
          count6Func++;
          matched = true;
        }
        if (has3Func) {
          count3Func++;
          matched = true;
        }
        if (hasOyoq) {
          countOyoq++;
          matched = true;
        }
        if (hasHadiya) {
          countHadiya++;
          matched = true;
        }

        if (!matched && (combinedText.trim().length > 0 || deals.length > 0)) {
          countOtherProduct++;
        }

        // 3. Purchase Intent
        const hasWonOrActiveDeal = deals.some(d => d.status === 'won' || d.status === 'active');
        const hasLostDeal = deals.some(d => d.status === 'lost' || isDealCanceled(d));
        const hasPhone = /\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(combinedText) || /\b\d{9}\b/.test(combinedText);
        const hasDeliveryAddress = /manzil|lokatsiya|lakatsiya|adress|address|uyga|nestone|shahar|rayon|etkaz|dostavka|доставка|адрес|уйимга/i.test(combinedText);
        const hasBuyKeywords = /olaman|olmoqchiman|zakaz|buyurtma|kuryer|sotib ol|оламан|буюртма|заказ|олмокчиман/i.test(combinedText);
        const hasPriceInquiry = /narx|narxi|qancha|necha|pul|bahosi|неч пул|нечи пул|нечпул|қанча|баҳоси|нархи|нарх/i.test(combinedText);

        if (hasWonOrActiveDeal || hasPhone || hasDeliveryAddress || hasBuyKeywords) {
          purchaseCount++;
        } else if (hasLostDeal || hasPriceInquiry) {
          inquiryCount++;
        } else {
          otherCount++;
        }

        // 4. Lost Reasons
        if (hasLostDeal) {
          let lostMatched = false;
          const dealNotesText = deals.map(d => d.notes || '').join(' ').toLowerCase();
          const fullLostText = combinedText + ' ' + dealNotesText;

          if (/qimmat|qmat|dorogo|baland|qimmatroq|arzon|arzonroq|дорого|киммат/i.test(fullLostText)) {
            lostPriceCount++;
            lostMatched = true;
          }
          if (/dostavka|yetkaz|pochta|kuryer|yolkira|yo'lkira|uzoq|доставка/i.test(fullLostText)) {
            lostDeliveryCount++;
            lostMatched = true;
          }
          if (/o'ylab|oylab|maslahat|ertaga|keyinroq|ko'ray|koray|подумаю|подумаем|маслахат/i.test(fullLostText)) {
            lostThinkingCount++;
            lostMatched = true;
          }
          if (/kech javob|kechikdi|kutdim|javob yoz|uyqu|kech yoz|поздно|долго/i.test(fullLostText)) {
            lostLateResponseCount++;
            lostMatched = true;
          }
          if (!lostMatched) {
            lostOtherCount++;
          }
        }

        texts.forEach(t => {
          const trimmed = t.trim();
          if (trimmed.length > 10 && trimmed.length < 100 && sampleOpinions.length < 10) {
            // Skip phone numbers and system/promotional message templates
            if (/\+?998|9[012345789]\s?\d{3}|desco\.premium|murojat uchun|murojaat uchun|murojat/i.test(trimmed)) return;
            if (trimmed.includes('http') || trimmed.includes('www.')) return;

            const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
            if (!sampleOpinions.some(op => op.toLowerCase() === trimmed.toLowerCase())) {
              sampleOpinions.push(capitalized);
            }
          }
        });
      });
    }

    res.json({
      totalMessages,
      incomingMessages,
      linkedClients,
      igSpent,
      igLeads,
      igCpl,
      dailyActiveChats,
      dailyIncomingWriters,
      averageWritersPerDay,
      todayWritersCount,
      paymentPreferences: {
        nasiya: nasiyaCount,
        naqd: naqdCount,
        unspecified: unspecifiedCount
      },
      productInterests: {
        func6: count6Func,
        func3: count3Func,
        oyoq: countOyoq,
        hadiya: countHadiya,
        other: countOtherProduct
      },
      purchaseIntent: {
        purchase: purchaseCount,
        inquiry: inquiryCount,
        other: otherCount
      },
      lostReasons: {
        price: lostPriceCount,
        delivery: lostDeliveryCount,
        thinking: lostThinkingCount,
        lateResponse: lostLateResponseCount,
        other: lostOtherCount
      },
      sampleOpinions
    });
  } catch(e) {
    console.error('Instagram stats error:', e);
    res.json({
      totalMessages: 0,
      incomingMessages: 0,
      linkedClients: 0,
      igSpent: 0,
      igLeads: 0,
      igCpl: 0,
      dailyActiveChats: [],
      paymentPreferences: { nasiya: 0, naqd: 0, unspecified: 0 },
      productInterests: { func6: 0, func3: 0, oyoq: 0, hadiya: 0, other: 0 },
      purchaseIntent: { purchase: 0, inquiry: 0, other: 0 },
      lostReasons: { price: 0, delivery: 0, thinking: 0, lateResponse: 0, other: 0 },
      sampleOpinions: []
    });
  }
});

// ── Zakazlar holati (pipeline stage breakdown) ──
router.get('/pipeline-stats', async (req, res) => {
  try {
    const where = buildWhere(req.query.filter, req);
    if (req.user?.role !== 'admin') where.managerId = req.userId;
    const pipeline = await prisma.pipeline.findFirst({
      where: { name: { contains: 'zakaz', mode: 'insensitive' } }
    });
    const stages = await prisma.pipelineStage.findMany({
      where: { pipelineId: pipeline ? pipeline.id : -1 },
      include: { _count: { select: { deals: { where } } } },
      orderBy: { order: 'asc' }
    });
    res.json(stages.map(s => ({ id: s.id, name: s.name, color: s.color, count: s._count.deals, pipelineId: s.pipelineId })));
  } catch(e) {
    res.json([]);
  }
});

// ── Mijozlar qiziqishi va shikoyatlar ──
router.get('/client-insights', async (req, res) => {
  try {
    const where = buildWhere(req.query.filter, req);
    if (req.user?.role !== 'admin') where.managerId = req.userId;

    const deals = await prisma.deal.findMany({
      where,
      include: { stage: { select: { name: true } }, client: { select: { city: true } } }
    });

    // Qaytgan (lost/negative) sdelkalar
    const negativeStageKeywords = ['rad', 'otkaz', 'negativ', 'qaytdi', "yo'qotilgan", 'lost'];
    const complaints = deals.filter(d =>
      d.status === 'lost' ||
      negativeStageKeywords.some(kw => (d.stage?.name || '').toLowerCase().includes(kw))
    ).length;

    // Muzokaradadagi sdelkalar
    const interested = deals.filter(d =>
      ['muzokara', 'taklif', 'qayta aloqa', 'peregovor', 'pereg'].some(kw => (d.stage?.name || '').toLowerCase().includes(kw))
    ).length;

    // Won sdelkalar
    const won = deals.filter(d =>
      d.status === 'won' ||
      ['100%', 'yutil', 'won'].some(kw => (d.stage?.name || '').toLowerCase().includes(kw))
    ).length;

    const total = deals.length;
    const satisfactionRate = total > 0 ? Math.round((won / total) * 100) : 0;
    const complaintRate = total > 0 ? Math.round((complaints / total) * 100) : 0;

    res.json({ total, won, interested, complaints, satisfactionRate, complaintRate });
  } catch(e) {
    res.json({ total: 0, won: 0, interested: 0, complaints: 0, satisfactionRate: 0, complaintRate: 0 });
  }
});

// ── Excel/CSV eksport ──
router.get('/export-csv', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const where = buildWhere(req.query.filter, req);
    if (!isAdmin) where.managerId = req.userId;

    const deals = await prisma.deal.findMany({
      where,
      include: {
        client: { select: { name: true, phone: true, city: true, company: true } },
        manager: { select: { fullName: true, email: true } },
        stage: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    const headers = ['ID', 'Mahsulot', 'Mijoz', 'Telefon', 'Shahar', 'Kompaniya', 'Menejer', 'Bosqich', 'Summa', 'Tolangan', 'Tan narx', 'Status', 'Sana'];
    const escape = (v) => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = deals.map(d => [
      d.id,
      d.productName,
      d.client?.name || '',
      d.client?.phone || '',
      d.client?.city || '',
      d.client?.company || '',
      d.manager?.fullName || d.manager?.email || '',
      d.stage?.name || '',
      d.amount,
      d.paidAmount,
      d.costPrice,
      d.status,
      d.createdAt ? new Date(d.createdAt).toLocaleDateString('uz-UZ') : ''
    ].map(escape).join(','));

    const csv = '﻿' + [headers.join(','), ...rows].join('\r\n'); // BOM for Excel UTF-8
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="desco-crm-${date}.csv"`);
    res.send(csv);
  } catch(e) {
    console.error('CSV Export error:', e);
    res.status(500).json({ message: 'Export xatosi' });
  }
});

// GET /api/dashboard/unread-chats
router.get('/unread-chats', protect, async (req, res) => {
  try {
    const [instagram, telegram] = await Promise.all([
      prisma.client.count({
        where: { 
          instagramUnreadCount: { gt: 0 },
          instagramId: { not: null }
        }
      }),
      prisma.client.count({
        where: { 
          telegramUnreadCount: { gt: 0 },
          telegramId: { not: null }
        }
      })
    ]);
    res.json({
      instagram,
      telegram
    });
  } catch (error) {
    console.error('Error fetching unread chats count:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router
