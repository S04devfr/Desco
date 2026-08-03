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

    const productGroupMap = {};

    // ProductCatalog'dan kelgan mahsulotlarni boshlang'ich qiymat sifatida qo'shish
    products.forEach(p => {
      productGroupMap[p.name] = {
        productName: p.name,
        variants: {}
      };
    });

    // Ombor zaxiralarini qo'shish va guruhlash
    stocks.forEach(s => {
      if (!productGroupMap[s.productName]) {
        productGroupMap[s.productName] = {
          productName: s.productName,
          variants: {}
        };
      }
      
      const colorKey = s.color || 'oddiy';
      if (!productGroupMap[s.productName].variants[colorKey]) {
        productGroupMap[s.productName].variants[colorKey] = {};
        allWarehouses.forEach(w => {
          productGroupMap[s.productName].variants[colorKey][w] = 0;
        });
      }
      productGroupMap[s.productName].variants[colorKey][s.warehouse] = s.stock;
    });

    // Guruhlangan ma'lumotlarni to'g'ri formatga o'tkazish
    const inventory = Object.values(productGroupMap).map(group => {
      if (Object.keys(group.variants).length === 0) {
        group.variants['oddiy'] = {};
        allWarehouses.forEach(w => { group.variants['oddiy'][w] = 0; });
      }

      const variantsArr = Object.entries(group.variants).map(([color, warehouses]) => {
        const total = Object.values(warehouses).reduce((s, v) => s + (v || 0), 0);
        return { color, warehouses, total };
      }).sort((a, b) => a.color.localeCompare(b.color));

      const productWarehouses = {};
      allWarehouses.forEach(w => { productWarehouses[w] = 0; });
      let productTotal = 0;

      variantsArr.forEach(v => {
        allWarehouses.forEach(w => {
          productWarehouses[w] += (v.warehouses[w] || 0);
        });
        productTotal += v.total;
      });

      return {
        productName: group.productName,
        warehouses: productWarehouses,
        total: productTotal,
        variants: variantsArr
      };
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

// ── POST /api/warehouse/update-stock — Zaxirani tahrirlash (to'g'rilash) ──
router.post('/update-stock', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { warehouse, productName, color, stock } = req.body;
    const parsedStock = parseInt(stock);
    if (!warehouse || !productName || isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ message: "Ombor, mahsulot va to'g'ri zaxira miqdori majburiy" });
    }
    const itemColor = color || 'oddiy';

    // 1. O'zgarishlar farqini hisoblash uchun joriy zaxirani olish (tarixga yozish uchun)
    const currentRecord = await prisma.warehouseStock.findUnique({
      where: { warehouse_productName_color: { warehouse, productName, color: itemColor } }
    });

    const oldStock = currentRecord ? currentRecord.stock : 0;
    const changeQty = parsedStock - oldStock;

    // Agar o'zgarish bo'lmasa, shunchaki javob qaytaramiz
    if (changeQty === 0) {
      return res.json({ success: true, message: "Zaxira o'zgarmadi" });
    }

    // 2. Yangi zaxirani saqlash
    await prisma.warehouseStock.upsert({
      where: { warehouse_productName_color: { warehouse, productName, color: itemColor } },
      update: { stock: parsedStock },
      create: { warehouse, productName, color: itemColor, stock: parsedStock }
    });

    // 3. Tarixga (logs) yozish
    await prisma.warehouseLog.create({
      data: {
        warehouse,
        productName,
        color: itemColor,
        changeQty: changeQty,
        action: changeQty > 0 ? 'fill' : 'ship',
        notes: `Zaxira tahrirlandi: ${oldStock} -> ${parsedStock}`,
        userName: req.user?.fullName || req.session?.user?.fullName || null
      }
    });

    res.json({ success: true, message: "Zaxira yangilandi" });
  } catch (err) {
    console.error('[Warehouse UPDATE STOCK]', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
