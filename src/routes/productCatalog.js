const express = require('express');
const prisma = require('../config/database');
const { protect } = require('../middleware/auth');

const router = express.Router();
router.use(protect);

// GET /api/product-catalog
router.get('/', async (req, res, next) => {
  try {
    const products = await prisma.productCatalog.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(products);
  } catch (error) { next(error); }
});

// POST /api/product-catalog
router.post('/', async (req, res, next) => {
  try {
    const { name, price, notes } = req.body;
    const product = await prisma.productCatalog.create({
      data: {
        name,
        price: Number(price) || 0,
        notes
      }
    });
    res.status(201).json(product);
  } catch (error) { next(error); }
});

// DELETE /api/product-catalog/:id
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.productCatalog.delete({
      where: { id: Number(req.params.id) }
    });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
