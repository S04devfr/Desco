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
    const where = buildWhere(req.query.filter, req);
    const deals = await prisma.deal.findMany({ where });
    // Expenses only use createdAt
    const expenseWhere = where.OR ? { createdAt: { gte: where.OR[0].createdAt.gte, lte: where.OR[0].createdAt.lte } } : {};
    const expenses = await prisma.expense.findMany({ where: expenseWhere });

    const totalOrders = deals.length
    const totalRevenue = deals.reduce((sum, d) => sum + d.paidAmount, 0)
    const totalDebt = deals.reduce((sum, d) => sum + Math.max(d.amount - d.paidAmount, 0), 0)
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0)
    const totalCostPrice = deals.reduce((sum, d) => sum + (d.costPrice || 0), 0)
    const netProfit = totalRevenue - totalCostPrice - totalExpenses

    // Fetch total client manual debt
    const clients = await prisma.client.findMany({ select: { debt: true } })
    const totalClientDebt = clients.reduce((sum, c) => sum + (c.debt || 0), 0)

    const won = deals.filter(d => d.status === 'won').length
    const lost = deals.filter(d => d.status === 'lost').length

    res.json({ totalOrders, totalRevenue, totalDebt, totalExpenses, totalCostPrice, netProfit, totalClientDebt, won, lost })
  } catch (error) {
    console.error('KPI Error:', error);
    return res.status(500).json({ error: 'Server xatosi: Ma\'lumot yuklanmadi', details: error.message });
  }
})

// Sales grouped by manager
router.get('/sales-by-manager', async (req, res, next) => {
  try {
    const where = buildWhere(req.query.filter, req);
    const deals = await prisma.deal.findMany({ where, include: { manager: true } })
    const totals = {}
    for (const deal of deals) {
      const name = deal.manager ? deal.manager.fullName : 'Belgilanmagan'
      totals[name] = (totals[name] || 0) + deal.amount
    }
    res.json(Object.entries(totals).map(([manager, totalSales]) => ({ manager, totalSales })))
  } catch (error) {
    console.error('Sales Error:', error);
    return res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
})

// Product popularity
router.get('/product-popularity', async (req, res, next) => {
  try {
    const where = buildWhere(req.query.filter, req);
    const deals = await prisma.deal.findMany({ where })
    const counts = {}
    for (const deal of deals) {
      counts[deal.productName] = (counts[deal.productName] || 0) + 1
    }
    res.json(Object.entries(counts).map(([product, count]) => ({ product, count })))
  } catch (error) {
    console.error('Product Error:', error);
    return res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
})

// Today's tasks
router.get('/today-tasks', async (req, res, next) => {
  try {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999)

    const where = {
      completed: false,
      dueDate: { gte: startOfDay, lte: endOfDay }
    }
    if (req.user.role !== 'admin') where.assignedToId = req.userId

    const tasks = await prisma.task.findMany({ where, orderBy: { dueDate: 'asc' } })
    res.json(tasks)
  } catch (error) {
    console.error('Tasks Error:', error);
    return res.status(500).json({ error: 'Server xatosi', details: error.message });
  }
})

module.exports = router
