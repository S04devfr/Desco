const express = require('express');
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');
const router = express.Router();

router.use(protect);

// ── DRIVERS (SHOPIRLAR) CRUD ──

// Get all drivers
router.get('/drivers', async (req, res, next) => {
  try {
    const drivers = await prisma.shopir.findMany({
      orderBy: { createdAt: 'asc' }
    });
    res.json(drivers);
  } catch (error) { next(error); }
});

// Create driver
router.post('/drivers', async (req, res, next) => {
  try {
    const driver = await prisma.shopir.create({
      data: {
        name: "Yangi Shopir",
        phone: "",
        region: "",
        price: 0,
        travelCost: 0,
        notes: ""
      }
    });
    res.status(201).json(driver);
  } catch (error) { next(error); }
});

// Update driver fields
router.patch('/drivers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, phone, region, price, travelCost, notes } = req.body;
    
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (region !== undefined) data.region = region;
    if (price !== undefined) data.price = Number(price) || 0;
    if (travelCost !== undefined) data.travelCost = Number(travelCost) || 0;
    if (notes !== undefined) data.notes = notes;

    const driver = await prisma.shopir.update({
      where: { id },
      data
    });
    res.json(driver);
  } catch (error) { next(error); }
});

// Delete driver
router.delete('/drivers/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.shopir.delete({ where: { id } });
    res.json({ message: 'Shopir o\'chirildi' });
  } catch (error) { next(error); }
});


// ── BRANCHES (ISHONCH FILIALLARI) CRUD ──

// Get all branches
router.get('/branches', async (req, res, next) => {
  try {
    const branches = await prisma.ishonchFilial.findMany({
      orderBy: { createdAt: 'asc' }
    });
    res.json(branches);
  } catch (error) { next(error); }
});

// Create branch
router.post('/branches', async (req, res, next) => {
  try {
    const branch = await prisma.ishonchFilial.create({
      data: {
        name: "Yangi Filial",
        phone: "",
        region: "",
        price: 0,
        travelCost: 0,
        notes: ""
      }
    });
    res.status(201).json(branch);
  } catch (error) { next(error); }
});

// Update branch fields
router.patch('/branches/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, phone, region, price, travelCost, notes } = req.body;
    
    const data = {};
    if (name !== undefined) data.name = name;
    if (phone !== undefined) data.phone = phone;
    if (region !== undefined) data.region = region;
    if (price !== undefined) data.price = Number(price) || 0;
    if (travelCost !== undefined) data.travelCost = Number(travelCost) || 0;
    if (notes !== undefined) data.notes = notes;

    const branch = await prisma.ishonchFilial.update({
      where: { id },
      data
    });
    res.json(branch);
  } catch (error) { next(error); }
});

// Delete branch
router.delete('/branches/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.ishonchFilial.delete({ where: { id } });
    res.json({ message: 'Filial o\'chirildi' });
  } catch (error) { next(error); }
});

module.exports = router;
