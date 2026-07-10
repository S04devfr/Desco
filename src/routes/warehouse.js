const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { requireRole } = require('../middleware/auth');

// ── GET /api/warehouse — Barcha mahsulotlarni omborlar kesimida olish ──
router.get('/', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const [stocks, products, logs] = await Promise.all([
      prisma.warehouseStock.findMany({ orderBy: { productName: 'asc' } }),
      prisma.productCatalog.findMany({ orderBy: { name: 'asc' } }),
      prisma.warehouseLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);

    // Mahsulotlar ro'yxatini yaratish (ProductCatalog + WarehouseStock)
    const stockMap = {};
    stocks.forEach(s => {
      if (!stockMap[s.productName]) {
        stockMap[s.productName] = { toshkent: 0, qoqon: 0 };
      }
      if (s.warehouse === 'Toshkent') stockMap[s.productName].toshkent = s.stock;
      if (s.warehouse === "Qo'qon") stockMap[s.productName].qoqon = s.stock;
    });

    // ProductCatalog'dan kelgan mahsulotlarni ham qo'shish
    products.forEach(p => {
      if (!stockMap[p.name]) {
        stockMap[p.name] = { toshkent: 0, qoqon: 0 };
      }
    });

    const inventory = Object.entries(stockMap).map(([name, data]) => ({
      productName: name,
      toshkent: data.toshkent,
      qoqon: data.qoqon,
      total: data.toshkent + data.qoqon
    })).sort((a, b) => a.productName.localeCompare(b.productName));

    res.json({ inventory, logs });
  } catch (err) {
    console.error('[Warehouse GET]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/warehouse/fill — Omborga tovar qo'shish ──
router.post('/fill', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { warehouse, productName, qty, notes } = req.body;
    if (!warehouse || !productName || !qty || qty <= 0) {
      return res.status(400).json({ message: "Ombor, mahsulot va miqdor majburiy" });
    }

    await prisma.warehouseStock.upsert({
      where: { warehouse_productName: { warehouse, productName } },
      update: { stock: { increment: parseInt(qty) } },
      create: { warehouse, productName, stock: parseInt(qty) }
    });

    await prisma.warehouseLog.create({
      data: {
        warehouse,
        productName,
        changeQty: parseInt(qty),
        action: 'fill',
        notes: notes || null,
        userName: req.session?.user?.fullName || null
      }
    });

    res.json({ success: true, message: `${productName} — ${warehouse}ga ${qty} ta qo'shildi` });
  } catch (err) {
    console.error('[Warehouse FILL]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/warehouse/transfer — Omborlararo ko'chirish ──
router.post('/transfer', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { fromWarehouse, toWarehouse, productName, qty, notes } = req.body;
    if (!fromWarehouse || !toWarehouse || !productName || !qty || qty <= 0) {
      return res.status(400).json({ message: "Barcha maydonlar majburiy" });
    }
    if (fromWarehouse === toWarehouse) {
      return res.status(400).json({ message: "Bir xil omborga ko'chirib bo'lmaydi" });
    }

    // Tekshirish: yetarli zaxira bormi
    const source = await prisma.warehouseStock.findUnique({
      where: { warehouse_productName: { warehouse: fromWarehouse, productName } }
    });
    if (!source || source.stock < parseInt(qty)) {
      return res.status(400).json({ message: `${fromWarehouse}da yetarli zaxira yo'q (mavjud: ${source?.stock || 0})` });
    }

    // Tranzaksiya
    await prisma.$transaction([
      prisma.warehouseStock.update({
        where: { warehouse_productName: { warehouse: fromWarehouse, productName } },
        data: { stock: { decrement: parseInt(qty) } }
      }),
      prisma.warehouseStock.upsert({
        where: { warehouse_productName: { warehouse: toWarehouse, productName } },
        update: { stock: { increment: parseInt(qty) } },
        create: { warehouse: toWarehouse, productName, stock: parseInt(qty) }
      }),
      prisma.warehouseLog.create({
        data: {
          warehouse: fromWarehouse,
          productName,
          changeQty: -parseInt(qty),
          action: 'transfer',
          notes: `${toWarehouse}ga ko'chirildi${notes ? '. ' + notes : ''}`,
          userName: req.session?.user?.fullName || null
        }
      }),
      prisma.warehouseLog.create({
        data: {
          warehouse: toWarehouse,
          productName,
          changeQty: parseInt(qty),
          action: 'transfer',
          notes: `${fromWarehouse}dan olindi${notes ? '. ' + notes : ''}`,
          userName: req.session?.user?.fullName || null
        }
      })
    ]);

    res.json({ success: true, message: `${qty} ta ${productName} — ${fromWarehouse} → ${toWarehouse}` });
  } catch (err) {
    console.error('[Warehouse TRANSFER]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/warehouse/logs — Tarix ──
router.get('/logs', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const logs = await prisma.warehouseLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    });
    res.json(logs);
  } catch (err) {
    console.error('[Warehouse LOGS]', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
