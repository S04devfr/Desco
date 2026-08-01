const express = require('express');
const router = express.Router();
const prisma = require('../config/database');
const { protect, requireRole } = require('../middleware/auth');

// Barcha warehouse endpointlari autentifikatsiya talab qiladi
router.use(protect);

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

    // Barcha ombor nomlarini dinamik aniqlash (hardcode yo'q)
    const allWarehouses = [...new Set(stocks.map(s => s.warehouse))].sort();

    const stockMap = {};
    stocks.forEach(s => {
      const displayName = s.color && s.color !== 'oddiy' ? `${s.productName} (${s.color})` : s.productName;
      if (!stockMap[displayName]) {
        stockMap[displayName] = {};
        allWarehouses.forEach(w => { stockMap[displayName][w] = 0; });
      }
      stockMap[displayName][s.warehouse] = s.stock;
    });

    // ProductCatalog'dan kelgan mahsulotlarni ham qo'shish
    products.forEach(p => {
      if (!stockMap[p.name]) {
        stockMap[p.name] = {};
        allWarehouses.forEach(w => { stockMap[p.name][w] = 0; });
      }
    });

    const inventory = Object.entries(stockMap).map(([name, warehouseData]) => {
      const total = Object.values(warehouseData).reduce((s, v) => s + (v || 0), 0);
      return { productName: name, warehouses: warehouseData, total };
    }).sort((a, b) => a.productName.localeCompare(b.productName));

    res.json({ inventory, logs, warehouses: allWarehouses });
  } catch (err) {
    console.error('[Warehouse GET]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/warehouse/fill — Omborga tovar qo'shish ──
router.post('/fill', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { warehouse, productName, color, qty, notes } = req.body;
    const parsedQty = parseInt(qty);
    if (!warehouse || !productName || isNaN(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ message: "Ombor, mahsulot va to'g'ri miqdor majburiy" });
    }
    const itemColor = color || 'oddiy';

    await prisma.warehouseStock.upsert({
      where: { warehouse_productName_color: { warehouse, productName, color: itemColor } },
      update: { stock: { increment: parsedQty } },
      create: { warehouse, productName, color: itemColor, stock: parsedQty }
    });

    await prisma.warehouseLog.create({
      data: {
        warehouse,
        productName,
        color: itemColor,
        changeQty: parsedQty,
        action: 'fill',
        notes: notes || null,
        userName: req.user?.fullName || req.session?.user?.fullName || null
      }
    });

    const displayColor = itemColor !== 'oddiy' ? ` (${itemColor})` : '';
    res.json({ success: true, message: `${productName}${displayColor} — ${warehouse}ga ${qty} ta qo'shildi` });
  } catch (err) {
    console.error('[Warehouse FILL]', err);
    res.status(500).json({ message: err.message });
  }
});

// ── POST /api/warehouse/transfer — Omborlararo ko'chirish ──
router.post('/transfer', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { fromWarehouse, toWarehouse, productName, color, qty, notes } = req.body;
    if (!fromWarehouse || !toWarehouse || !productName || !qty || qty <= 0) {
      return res.status(400).json({ message: "Barcha maydonlar majburiy" });
    }
    if (fromWarehouse === toWarehouse) {
      return res.status(400).json({ message: "Bir xil omborga ko'chirib bo'lmaydi" });
    }
    const itemColor = color || 'oddiy';

    // Tekshirish: yetarli zaxira bormi
    const source = await prisma.warehouseStock.findUnique({
      where: { warehouse_productName_color: { warehouse: fromWarehouse, productName, color: itemColor } }
    });
    if (!source || source.stock < parseInt(qty)) {
      const displayColor = itemColor !== 'oddiy' ? ` (${itemColor})` : '';
      return res.status(400).json({ message: `${fromWarehouse}da yetarli zaxira yo'q (mavjud: ${source?.stock || 0} ta ${productName}${displayColor})` });
    }

    // Tranzaksiya
    await prisma.$transaction([
      prisma.warehouseStock.update({
        where: { warehouse_productName_color: { warehouse: fromWarehouse, productName, color: itemColor } },
        data: { stock: { decrement: parseInt(qty) } }
      }),
      prisma.warehouseStock.upsert({
        where: { warehouse_productName_color: { warehouse: toWarehouse, productName, color: itemColor } },
        update: { stock: { increment: parseInt(qty) } },
        create: { warehouse: toWarehouse, productName, color: itemColor, stock: parseInt(qty) }
      }),
      prisma.warehouseLog.create({
        data: {
          warehouse: fromWarehouse,
          productName,
          color: itemColor,
          changeQty: -parseInt(qty),
          action: 'transfer',
          notes: `${toWarehouse}ga ko'chirildi${notes ? '. ' + notes : ''}`,
          userName: req.user?.fullName || req.session?.user?.fullName || null
        }
      }),
      prisma.warehouseLog.create({
        data: {
          warehouse: toWarehouse,
          productName,
          color: itemColor,
          changeQty: parseInt(qty),
          action: 'transfer',
          notes: `${fromWarehouse}dan olindi${notes ? '. ' + notes : ''}`,
          userName: req.user?.fullName || req.session?.user?.fullName || null
        }
      })
    ]);

    const displayColor = itemColor !== 'oddiy' ? ` (${itemColor})` : '';
    res.json({ success: true, message: `${qty} ta ${productName}${displayColor} — ${fromWarehouse} → ${toWarehouse}` });
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
